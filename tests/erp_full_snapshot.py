# Full snapshot / restore of erp_state data doc (used for P&L tests). Usage: snap|restore|diff
import json, sys
from bson import json_util
from pymongo import MongoClient
c = MongoClient("mongodb://localhost:27017")["test_database"]
SNAP = "/tmp/erp_full_snap.json"
doc = c.erp_state.find_one({})
cmd = sys.argv[1]
if cmd == "snap":
    open(SNAP, "w").write(json_util.dumps(doc["data"]))
    print("snap saved; version", doc.get("version"))
elif cmd == "diff":
    s = json_util.loads(open(SNAP).read())
    for k in sorted(set(s) | set(doc["data"])):
        if s.get(k) != doc["data"].get(k):
            print("DIFF", k)
    for k in sorted(set(s["settings"]) | set(doc["data"]["settings"])):
        if s["settings"].get(k) != doc["data"]["settings"].get(k):
            print("DIFF settings.", k)
    print("diff done")
elif cmd == "restore":
    s = json_util.loads(open(SNAP).read())
    c.erp_state.update_one({"_id": doc["_id"]}, {"$set": {"data": s, "version": (doc.get("version") or 0) + 1}})
    print("restored")
