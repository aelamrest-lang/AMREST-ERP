"""Multi-session concurrency tests for the record-level ERP store. Run: python3 /app/backend/tests/test_concurrency.py
Uses the local backend; every record it creates is removed and every stock change reverted at the end."""
import asyncio
import os
import uuid

import httpx

API = os.environ.get("TEST_API", "http://localhost:8001/api")
USERS = [("admin", "admin123"), ("testing", "test123"), ("production", "prod123"), ("aaa@amrest.in", "anwar@123"), ("admin", "admin123")]
results = []


def rec(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""))


async def login(c, u, p):
    r = await c.post(f"{API}/auth/login", json={"username": u, "password": p})
    return {"Authorization": "Bearer " + r.json()["token"]}


async def commit(c, h, ops, op_id=None):
    r = await c.post(f"{API}/erp/commit", headers=h, json={"opId": op_id or str(uuid.uuid4()), "ops": ops})
    return r.status_code, r.json()


async def state(c, h):
    return (await c.get(f"{API}/erp/state", headers=h)).json()


async def main():
    async with httpx.AsyncClient(timeout=120) as c:
        hs = [await login(c, u, p) for u, p in USERS]
        st = await state(c, hs[0])
        d, revs = st["data"], st["revs"]
        tag = uuid.uuid4().hex[:6]
        po = next((p for p in d["purchaseOrders"] if p.get("items") and p.get("status") not in ("Approved", "Partially Received", "Completed")), None) or next(p for p in d["purchaseOrders"] if p.get("items"))
        item = next(i for i in d["items"] if i.get("id"))
        stock0 = float(item.get("currentStock") or 0)
        created = []  # (coll, rid)

        # 1. Five employees create different GRNs simultaneously
        grns = [{"id": f"zz-{tag}-g{i}", "number": f"ZT{tag}-2026-{i + 1:03d}", "poId": po["id"], "date": "2026-11-05",
                 "receivedItems": [{"itemId": po["items"][0]["itemId"], "qty": 1}]} for i in range(5)]
        rs = await asyncio.gather(*[commit(c, hs[i], [{"kind": "upsert", "coll": "grns", "rid": g["id"], "baseRev": None, "data": g},
                                                      {"kind": "upsert", "coll": "logs", "rid": f"zz-{tag}-l{i}", "data": {"id": f"zz-{tag}-l{i}", "userId": "t", "action": f"GRN {g['number']} created", "module": "GRN", "timestamp": "2026-11-05T00:00:00Z"}}])
                                    for i, g in enumerate(grns)])
        created += [("grns", g["id"]) for g in grns] + [("logs", f"zz-{tag}-l{i}") for i in range(5)]
        s2 = await state(c, hs[1])
        ids = {g["id"] for g in s2["data"]["grns"]}
        logs = {l["id"] for l in s2["data"]["logs"]}
        rec("5 users create GRNs simultaneously — all committed", all(r[0] == 200 for r in rs) and all(g["id"] in ids for g in grns), str([r[0] for r in rs]))
        rec("Activity logs match committed GRNs", all(f"zz-{tag}-l{i}" in logs for i in range(5)))

        # 2. Two employees create GRNs against the same PO (covered above: all 5 on same PO) → PO status derived server-side
        rec("GRNs against same PO all kept", sum(1 for g in s2["data"]["grns"] if g["poId"] == po["id"] and g["id"].startswith(f"zz-{tag}")) == 5)

        # 3. Two employees edit the same GRN
        rv = s2["revs"]["grns"][grns[0]["id"]]
        a, b = await asyncio.gather(commit(c, hs[0], [{"kind": "upsert", "coll": "grns", "rid": grns[0]["id"], "baseRev": rv, "data": {**grns[0], "remarks": "A"}}]),
                                    commit(c, hs[1], [{"kind": "upsert", "coll": "grns", "rid": grns[0]["id"], "baseRev": rv, "data": {**grns[0], "remarks": "B"}}]))
        codes = sorted([a[0], b[0]])
        rec("Same GRN edited by 2 users → one saved, other gets 409 conflict (no silent overwrite)", codes == [200, 409], str(codes))

        # 4. Multiple production entries simultaneously
        pes = [{"id": f"zz-{tag}-p{i}", "date": "2026-11-05", "jobCardId": "zz", "stage": "HV Winding", "todayQty": 1} for i in range(5)]
        rs = await asyncio.gather(*[commit(c, hs[i], [{"kind": "upsert", "coll": "productionEntries", "rid": p["id"], "baseRev": None, "data": p}]) for i, p in enumerate(pes)])
        created += [("productionEntries", p["id"]) for p in pes]
        s3 = await state(c, hs[2])
        pids = {p["id"] for p in s3["data"]["productionEntries"]}
        rec("5 simultaneous production entries all committed", all(r[0] == 200 for r in rs) and all(p["id"] in pids for p in pes))

        # 5. Stock in and stock out at the same time
        deltas = [5, -2, 3, -1, 4]
        rs = await asyncio.gather(*[commit(c, hs[i], [{"kind": "inc", "coll": "items", "rid": item["id"], "delta": dl}]) for i, dl in enumerate(deltas)])
        s4 = await state(c, hs[3])
        stock1 = float(next(i for i in s4["data"]["items"] if i["id"] == item["id"]).get("currentStock") or 0)
        rec("Concurrent stock in/out → exact balance", abs(stock1 - (stock0 + sum(deltas))) < 1e-6, f"{stock0} → {stock1} (expected {stock0 + sum(deltas)})")

        # 6. Retry after timeout with the same one-time key → no double stock / record
        oid = str(uuid.uuid4())
        r1 = await commit(c, hs[0], [{"kind": "inc", "coll": "items", "rid": item["id"], "delta": 10}], oid)
        r2 = await commit(c, hs[0], [{"kind": "inc", "coll": "items", "rid": item["id"], "delta": 10}], oid)
        s5 = await state(c, hs[0])
        stock2 = float(next(i for i in s5["data"]["items"] if i["id"] == item["id"]).get("currentStock") or 0)
        rec("Retry with same key is not applied twice", r1[0] == 200 and r2[1].get("replayed") and abs(stock2 - (stock1 + 10)) < 1e-6, f"{stock1} → {stock2}")

        # 7. Session expired during save
        r = await c.post(f"{API}/erp/commit", headers={"Authorization": "Bearer expired.token"}, json={"opId": str(uuid.uuid4()), "ops": [{"kind": "inc", "coll": "items", "rid": item["id"], "delta": 99}]})
        s6 = await state(c, hs[0])
        stock3 = float(next(i for i in s6["data"]["items"] if i["id"] == item["id"]).get("currentStock") or 0)
        rec("Expired session → 401 and nothing written", r.status_code == 401 and abs(stock3 - stock2) < 1e-6, str(r.status_code))

        # 8. Two users create records with the same document number
        num = f"ZN{tag}-2026-001"
        a, b = await asyncio.gather(commit(c, hs[0], [{"kind": "upsert", "coll": "grns", "rid": f"zz-{tag}-n1", "baseRev": None, "data": {"id": f"zz-{tag}-n1", "number": num, "poId": po["id"], "receivedItems": []}}]),
                                    commit(c, hs[1], [{"kind": "upsert", "coll": "grns", "rid": f"zz-{tag}-n2", "baseRev": None, "data": {"id": f"zz-{tag}-n2", "number": num, "poId": po["id"], "receivedItems": []}}]))
        created += [("grns", f"zz-{tag}-n1"), ("grns", f"zz-{tag}-n2")]
        codes = sorted([a[0], b[0]])
        rec("Duplicate document number → one accepted, other rejected (409 duplicates)", codes == [200, 409], str(codes))

        # 9. Multiple modules save simultaneously
        rs = await asyncio.gather(
            commit(c, hs[0], [{"kind": "upsert", "coll": "materialIssues", "rid": f"zz-{tag}-mi", "baseRev": None, "data": {"id": f"zz-{tag}-mi", "number": f"ZM{tag}-2026-001", "date": "2026-11-05", "lines": []}}]),
            commit(c, hs[1], [{"kind": "upsert", "coll": "sfgBatches", "rid": f"zz-{tag}-sb", "baseRev": None, "data": {"id": f"zz-{tag}-sb", "date": "2026-11-05", "itemId": "x", "qtyProduced": 0}}]),
            commit(c, hs[2], [{"kind": "upsert", "coll": "challans", "rid": f"zz-{tag}-si", "baseRev": None, "data": {"id": f"zz-{tag}-si", "number": f"ZI{tag}-2026-001", "date": "2026-11-05", "items": [], "dispatches": []}}]),
            commit(c, hs[3], [{"kind": "upsert", "coll": "qcTests", "rid": f"zz-{tag}-qc", "baseRev": None, "data": {"id": f"zz-{tag}-qc"}}]),
            commit(c, hs[4], [{"kind": "upsert", "coll": "jobCards", "rid": f"zz-{tag}-jc", "baseRev": None, "data": {"id": f"zz-{tag}-jc", "number": f"ZJ{tag}-2026-001", "stages": [], "reservedItems": []}}]))
        created += [("materialIssues", f"zz-{tag}-mi"), ("sfgBatches", f"zz-{tag}-sb"), ("challans", f"zz-{tag}-si"), ("qcTests", f"zz-{tag}-qc"), ("jobCards", f"zz-{tag}-jc")]
        rec("5 modules saved simultaneously — all committed", all(r[0] == 200 for r in rs), str([r[0] for r in rs]))

        # 10. Stale delete of a record changed by someone else is rejected
        s7 = await state(c, hs[0])
        rv = s7["revs"]["grns"][grns[1]["id"]]
        await commit(c, hs[1], [{"kind": "upsert", "coll": "grns", "rid": grns[1]["id"], "baseRev": rv, "data": {**grns[1], "remarks": "edited"}}])
        r = await commit(c, hs[0], [{"kind": "delete", "coll": "grns", "rid": grns[1]["id"], "baseRev": rv}])
        rec("Stale delete of a record edited by another user → 409", r[0] == 409, str(r[0]))

        # cleanup
        s8 = await state(c, hs[0])
        ops = [{"kind": "delete", "coll": coll, "rid": rid, "baseRev": s8["revs"].get(coll, {}).get(rid)} for coll, rid in created if coll == "logs" or s8["revs"].get(coll, {}).get(rid)]
        ops.append({"kind": "inc", "coll": "items", "rid": item["id"], "delta": stock0 - stock2})
        r = await commit(c, hs[0], ops)
        s9 = await state(c, hs[0])
        left = [x for x in sum([v for v in s9["data"].values() if isinstance(v, list)], []) if isinstance(x, dict) and str(x.get("id", "")).startswith(f"zz-{tag}")]
        stock_end = float(next(i for i in s9["data"]["items"] if i["id"] == item["id"]).get("currentStock") or 0)
        rec("Cleanup: test records removed, stock restored", r[0] == 200 and not left and abs(stock_end - stock0) < 1e-6, f"left={len(left)} stock={stock_end}")
    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} passed")
    return failed


if __name__ == "__main__":
    asyncio.run(main())
