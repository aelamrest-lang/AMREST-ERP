"""Record-level ERP storage: one Mongo document per record, revision checks, atomic stock increments,
unique document numbers, idempotent commits and an audit trail."""
import asyncio
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from pydantic import BaseModel
from pymongo import ASCENDING, DESCENDING
from pymongo.errors import DuplicateKeyError

NUMBERED = ["grns", "purchaseOrders", "materialIssues", "jobCards", "challans", "quotations", "salesOrders", "proformas"]
NUM_RE = re.compile(r"^(.*?-\d{4}-)(\d+)")
STOCK_FIELD = "currentStock"
LOG_LIMIT = 500
META_ID = "record-store"
_lock = asyncio.Lock()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def short_num(coll: str, data: dict) -> Optional[str]:
    if coll not in NUMBERED:
        return None
    m = NUM_RE.match(str((data or {}).get("number") or ""))
    return m.group(1) + m.group(2) if m else None


class Op(BaseModel):
    kind: str                      # upsert | delete | inc | set
    coll: Optional[str] = None     # list collection for upsert/delete/inc
    rid: Optional[str] = None
    baseRev: Optional[int] = None  # None = new record (upsert) / unchecked
    data: Optional[dict] = None
    delta: Optional[float] = None  # inc
    key: Optional[str] = None      # set: "settings.<sub>" or top-level scalar key
    value: Any = None


class CommitBody(BaseModel):
    opId: str
    ops: list[Op]


class Conflict(Exception):
    def __init__(self, payload: dict):
        self.payload = payload


class RecordStore:
    def __init__(self, db, client):
        self.db, self.client = db, client
        self.rec, self.val, self.meta, self.applied, self.audit = db.erp_records, db.erp_values, db.erp_meta, db.erp_applied, db.erp_audit
        self.tx = None

    async def init(self):
        await self.rec.create_index([("coll", ASCENDING), ("ord", DESCENDING)])
        await self.rec.create_index([("ver", ASCENDING)])
        await self.rec.create_index([("coll", ASCENDING), ("num", ASCENDING)], unique=True, partialFilterExpression={"num": {"$type": "string"}})
        await self.val.create_index([("ver", ASCENDING)])
        await self.audit.create_index([("coll", ASCENDING), ("rid", ASCENDING)])
        try:
            hello = await self.client.admin.command("hello")
            self.tx = bool(hello.get("setName") or hello.get("msg") == "isdbgrid")
        except Exception:
            self.tx = False

    async def is_active(self) -> bool:
        m = await self.meta.find_one({"_id": META_ID})
        return bool(m and m.get("active"))

    async def version(self) -> int:
        m = await self.meta.find_one({"_id": META_ID})
        return int((m or {}).get("version", 0))

    # ---------- migration ----------
    async def migrate_from(self, state: dict, version: int) -> dict:
        await self.rec.delete_many({})
        await self.val.delete_many({})
        batch, counts = [], {}
        for key, value in state.items():
            if isinstance(value, list):
                n = len(value)
                counts[key] = n
                for i, item in enumerate(value):
                    rid = str(item.get("id")) if isinstance(item, dict) and item.get("id") else f"{key}-{i}"
                    doc = {"_id": f"{key}:{rid}", "coll": key, "rid": rid, "rev": 1, "srev": 0, "ord": float(n - i), "ver": version, "data": item}
                    num = short_num(key, item)
                    if num:
                        doc["num"] = num
                    batch.append(doc)
                    if len(batch) >= 1000:
                        await self._insert_batch(batch)
                        batch = []
            elif isinstance(value, dict) and key == "settings":
                for sub, v in value.items():
                    await self.val.replace_one({"_id": f"settings.{sub}"}, {"_id": f"settings.{sub}", "rev": 1, "ver": version, "value": v}, upsert=True)
            else:
                await self.val.replace_one({"_id": key}, {"_id": key, "rev": 1, "ver": version, "value": value}, upsert=True)
        if batch:
            await self._insert_batch(batch)
        stock = sum(float((i or {}).get(STOCK_FIELD) or 0) for i in state.get("items", []))
        report = {"counts": counts, "stockSum": round(stock, 4), "at": now_iso()}
        await self.meta.replace_one({"_id": META_ID}, {"_id": META_ID, "active": True, "version": version, "migration": report}, upsert=True)
        return report

    async def _insert_batch(self, batch):
        for d in batch:  # duplicate legacy numbers (e.g. two GRN-2026-184) are kept, only the 2nd+ lose the unique key
            try:
                await self.rec.insert_one(d)
            except DuplicateKeyError:
                d.pop("num", None)
                d["legacyDuplicateNumber"] = True
                await self.rec.insert_one(d)

    # ---------- reads ----------
    async def read_state(self) -> dict:
        out: dict = {"settings": {}}
        revs: dict = {}
        async for r in self.rec.find({"deleted": {"$ne": True}, "coll": {"$ne": "logs"}}).sort([("coll", ASCENDING), ("ord", DESCENDING)]):
            out.setdefault(r["coll"], []).append(r["data"])
            revs.setdefault(r["coll"], {})[r["rid"]] = r["rev"]
        meta = await self.meta.find_one({"_id": META_ID}) or {}
        for k in (meta.get("migration") or {}).get("counts", {}):
            out.setdefault(k, [])
        out["logs"] = [r["data"] async for r in self.rec.find({"coll": "logs", "deleted": {"$ne": True}}).sort("ord", DESCENDING).limit(LOG_LIMIT)]
        vrevs = {}
        async for v in self.val.find({}):
            if v["_id"].startswith("settings."):
                out["settings"][v["_id"][9:]] = v["value"]
            else:
                out[v["_id"]] = v["value"]
            vrevs[v["_id"]] = v["rev"]
        return {"data": out, "revs": revs, "vrevs": vrevs, "version": await self.version()}

    async def changes_since(self, since: int) -> dict:
        recs = [{"coll": r["coll"], "rid": r["rid"], "rev": r["rev"], "deleted": bool(r.get("deleted")), "data": r.get("data"), "ord": r.get("ord")}
                async for r in self.rec.find({"ver": {"$gt": since}})]
        vals = [{"key": v["_id"], "rev": v["rev"], "value": v.get("value")} async for v in self.val.find({"ver": {"$gt": since}})]
        return {"records": recs, "values": vals, "version": await self.version()}

    async def users(self) -> list:
        return [r["data"] async for r in self.rec.find({"coll": "users", "deleted": {"$ne": True}})]

    # ---------- commit ----------
    async def commit(self, body: CommitBody, user_id: str) -> dict:
        async with _lock:
            done = await self.applied.find_one({"_id": body.opId})
            if done:
                return {**done["result"], "replayed": True}
            if self.tx:
                async with await self.client.start_session() as s:
                    async with s.start_transaction():
                        result = await self._apply(body, user_id, s)
            else:
                result = await self._apply(body, user_id, None)
            return result

    async def _apply(self, body: CommitBody, user_id: str, s) -> dict:
        ops = body.ops
        conflicts, dups = [], []
        cur = {}
        for op in ops:
            if op.kind in ("upsert", "delete"):
                r = await self.rec.find_one({"_id": f"{op.coll}:{op.rid}"}, session=s)
                cur[(op.coll, op.rid)] = r
                live = r and not r.get("deleted")
                if op.kind == "upsert" and op.baseRev is None:
                    if live and op.coll != "logs":
                        conflicts.append({"coll": op.coll, "rid": op.rid, "reason": "exists", "theirs": r["data"], "rev": r["rev"]})
                elif op.coll != "logs" and (not r or r["rev"] != op.baseRev or (op.kind == "upsert" and not live)):
                    conflicts.append({"coll": op.coll, "rid": op.rid, "reason": "deleted" if (not live) else "changed",
                                      "theirs": r["data"] if live else None, "rev": r["rev"] if r else None})
                if op.kind == "upsert":
                    num = short_num(op.coll, op.data)
                    if num:
                        other = await self.rec.find_one({"coll": op.coll, "num": num, "_id": {"$ne": f"{op.coll}:{op.rid}"}}, session=s)
                        if other:
                            dups.append({"coll": op.coll, "rid": op.rid, "number": num})
            elif op.kind == "set":
                v = await self.val.find_one({"_id": op.key}, session=s)
                if (v["rev"] if v else None) != op.baseRev and not (v is None and op.baseRev == 0):
                    conflicts.append({"key": op.key, "reason": "changed", "theirs": v.get("value") if v else None, "rev": v["rev"] if v else None})
        if conflicts or dups:
            raise Conflict({"conflicts": conflicts, "duplicates": dups})

        meta = await self.meta.find_one_and_update({"_id": META_ID}, {"$inc": {"version": 1}}, return_document=True, session=s)
        ver, at = meta["version"], now_iso()
        top = await self.rec.find_one({}, sort=[("ord", DESCENDING)], session=s)
        next_ord = float((top or {}).get("ord", 0)) + 1
        revs, audit = [], []
        for op in ops:
            if op.kind == "upsert":
                prev = cur.get((op.coll, op.rid))
                data = dict(op.data or {})
                if op.coll == "items" and prev and prev.get("data") and not prev.get("deleted"):
                    data[STOCK_FIELD] = prev["data"].get(STOCK_FIELD, 0)  # stock only moves through atomic "inc" ops
                derived = ("Approved", "Partially Received", "Completed")
                if op.coll == "purchaseOrders" and prev and prev.get("data", {}).get("status") in derived and data.get("status") in derived:
                    data["status"] = prev["data"]["status"]  # receipt status is derived server-side from GRNs
                doc = {"coll": op.coll, "rid": op.rid, "data": data, "ver": ver, "deleted": False}
                num = short_num(op.coll, data)
                if num:
                    doc["num"] = num
                if prev:
                    await self.rec.update_one({"_id": prev["_id"]}, {"$set": doc, "$inc": {"rev": 1}, **({} if num else {"$unset": {"num": ""}})}, session=s)
                    rev = prev["rev"] + 1
                else:
                    await self.rec.insert_one({"_id": f"{op.coll}:{op.rid}", **doc, "rev": 1, "srev": 0, "ord": next_ord}, session=s)
                    next_ord += 1
                    rev = 1
                revs.append({"coll": op.coll, "rid": op.rid, "rev": rev})
                if op.coll != "logs":
                    before = (prev or {}).get("data") if prev and not prev.get("deleted") else None
                    changed = {k: {"from": (before or {}).get(k), "to": v} for k, v in data.items() if not before or before.get(k) != v}
                    audit.append({"coll": op.coll, "rid": op.rid, "action": "update" if before else "create", "changes": changed})
            elif op.kind == "delete":
                prev = cur.get((op.coll, op.rid))
                if prev:
                    await self.rec.update_one({"_id": prev["_id"]}, {"$set": {"deleted": True, "ver": ver}, "$inc": {"rev": 1}, "$unset": {"num": ""}}, session=s)
                    if op.coll != "logs":
                        audit.append({"coll": op.coll, "rid": op.rid, "action": "delete", "changes": {"before": prev.get("data")}})
            elif op.kind == "inc":
                r = await self.rec.find_one_and_update({"_id": f"{op.coll}:{op.rid}", "deleted": {"$ne": True}},
                                                       {"$inc": {f"data.{STOCK_FIELD}": float(op.delta or 0), "srev": 1}, "$set": {"ver": ver}},
                                                       return_document=True, session=s)
                if r:
                    audit.append({"coll": op.coll, "rid": op.rid, "action": "stock", "changes": {STOCK_FIELD: {"delta": op.delta, "to": r["data"].get(STOCK_FIELD)}}})
            elif op.kind == "set":
                v = await self.val.find_one_and_update({"_id": op.key}, {"$set": {"value": op.value, "ver": ver}, "$inc": {"rev": 1}}, upsert=True, return_document=True, session=s)
                revs.append({"key": op.key, "rev": v["rev"]})
        await self._derive_po_status(ops, ver, s)
        if audit:
            await self.audit.insert_many([{**a, "_id": str(uuid.uuid4()), "userId": user_id, "opId": body.opId, "at": at, "ver": ver} for a in audit], session=s)
        result = {"ok": True, "version": ver, "revs": revs}
        await self.applied.insert_one({"_id": body.opId, "result": result, "at": at, "userId": user_id}, session=s)
        return result

    async def _derive_po_status(self, ops, ver, s):
        po_ids = {(op.data or {}).get("poId") for op in ops if op.coll == "grns" and op.kind == "upsert"}
        for op in ops:
            if op.coll == "grns" and op.kind == "delete":
                r = await self.rec.find_one({"_id": f"grns:{op.rid}"}, session=s)
                po_ids.add((r or {}).get("data", {}).get("poId"))
        for pid in filter(None, po_ids):
            po = await self.rec.find_one({"_id": f"purchaseOrders:{pid}"}, session=s)
            if not po or po.get("deleted") or po["data"].get("status") not in ("Approved", "Partially Received", "Completed"):
                continue
            recv: dict = {}
            async for g in self.rec.find({"coll": "grns", "deleted": {"$ne": True}, "data.poId": pid}, session=s):
                for it in g["data"].get("receivedItems", []):
                    recv[it.get("itemId")] = recv.get(it.get("itemId"), 0) + float(it.get("qty") or 0)
            items = po["data"].get("items", [])
            st = "Completed" if items and all(recv.get(i.get("itemId"), 0) >= float(i.get("qty") or 0) for i in items) else ("Partially Received" if any(recv.get(i.get("itemId"), 0) > 0 for i in items) else "Approved")
            if st != po["data"].get("status"):
                await self.rec.update_one({"_id": po["_id"]}, {"$set": {"data.status": st, "ver": ver}, "$inc": {"srev": 1}}, session=s)
