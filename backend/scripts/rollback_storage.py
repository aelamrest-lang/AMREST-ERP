"""Rollback for the record-level storage migration.

  python3 scripts/rollback_storage.py --from-records      # rebuild the old chunked state from the CURRENT records (keeps all new data)
  python3 scripts/rollback_storage.py --from-backup TS     # restore the exact pre-migration snapshot (erp_backup_chunks, backup=TS)
  python3 scripts/rollback_storage.py --list               # list available backups

After rollback, restore the previous app version (platform Rollback) — the old app reads erp_chunks.
"""
import asyncio
import os
import sys

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
CHUNK = 1000


async def write_chunks(state: dict):
    await db.erp_chunks.delete_many({})
    for key, value in state.items():
        if isinstance(value, list):
            parts = [value[i:i + CHUNK] for i in range(0, len(value), CHUNK)] or [[]]
            for idx, part in enumerate(parts):
                await db.erp_chunks.insert_one({"_id": f"{key}#{idx}", "key": key, "idx": idx, "kind": "list", "items": part})
        else:
            await db.erp_chunks.insert_one({"_id": f"{key}#0", "key": key, "idx": 0, "kind": "value", "value": value})


async def main():
    arg = sys.argv[1:] or ["--list"]
    if arg[0] == "--list":
        print(sorted(await db.erp_backup_chunks.distinct("backup")))
        return
    meta = await db.erp_meta.find_one({"_id": "record-store"}) or {}
    if arg[0] == "--from-records":
        state: dict = {"settings": {}}
        async for r in db.erp_records.find({"deleted": {"$ne": True}}).sort([("coll", 1), ("ord", -1)]):
            state.setdefault(r["coll"], []).append(r["data"])
        async for v in db.erp_values.find({}):
            if v["_id"].startswith("settings."):
                state["settings"][v["_id"][9:]] = v["value"]
            else:
                state[v["_id"]] = v["value"]
        await write_chunks(state)
    elif arg[0] == "--from-backup":
        await db.erp_chunks.delete_many({})
        async for c in db.erp_backup_chunks.find({"backup": arg[1]}):
            c["_id"] = c["_id"].split(":", 1)[1]
            c.pop("backup", None)
            await db.erp_chunks.insert_one(c)
    await db.erp_state.update_one({"_id": "amrest-main"}, {"$set": {"storage": "chunked", "version": int(meta.get("version", 1)) + 1}}, upsert=True)
    await db.erp_meta.update_one({"_id": "record-store"}, {"$set": {"active": False}})
    print("Rolled back. Chunk docs:", await db.erp_chunks.count_documents({}))


asyncio.run(main())
