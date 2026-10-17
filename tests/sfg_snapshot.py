# Snapshot / inspect / restore SFG mapping & stock data in erp_state (Copy SFG Mapping tests)
import json, sys
from pymongo import MongoClient
c = MongoClient("mongodb://localhost:27017")["test_database"]
SNAP = "/tmp/sfg_snap.json"
KEYS = ["sfgBatches", "sfgConsumptions", "productionEntries"]

def get():
    return c.erp_state.find_one({})

cmd = sys.argv[1]
doc = get()
d = doc["data"]
if cmd == "snap":
    s = {"settings": {k: d["settings"].get(k) for k in ["sfgStageItemsByJc", "sfgConsumptionMapByJc"]}, **{k: d.get(k) for k in KEYS}, "items": d.get("items")}
    json.dump(s, open(SNAP, "w"))
    print("snap saved; version", doc.get("version"))
elif cmd == "show":
    jcs = {j["id"]: (j["number"].split(" - ")[0], j.get("product"), j.get("bomId"), [s["stage"] for s in j.get("stages") or []]) for j in d["jobCards"]}
    items = {i["id"]: i["name"] for i in d["items"]}
    p = d["settings"].get("sfgStageItemsByJc") or {}
    cm = d["settings"].get("sfgConsumptionMapByJc") or {}
    for jid in set(p) | set(cm):
        print(jcs.get(jid, jid)[0], jcs.get(jid, ("", ""))[1])
        print("  prod:", {k: items.get(v, v) for k, v in (p.get(jid) or {}).items()})
        print("  cons:", {k: [(items.get(r["itemId"]), r["qtyPerUnit"]) for r in v] for k, v in (cm.get(jid) or {}).items()})
    if len(sys.argv) > 2:
        for jid, v in jcs.items():
            print(v)
    print("counts", {k: len(d.get(k) or []) for k in KEYS})
elif cmd == "diff":
    s = json.load(open(SNAP))
    for k in KEYS:
        print(k, "same" if s[k] == d.get(k) else "DIFF")
    for k in ["sfgStageItemsByJc", "sfgConsumptionMapByJc"]:
        print(k, "same" if s["settings"][k] == d["settings"].get(k) else "DIFF")
elif cmd == "restore":
    s = json.load(open(SNAP))
    for k in ["sfgStageItemsByJc", "sfgConsumptionMapByJc"]:
        d["settings"][k] = s["settings"][k]
    for k in KEYS:
        d[k] = s[k]
    d["items"] = s["items"]
    c.erp_state.update_one({"_id": doc["_id"]}, {"$set": {"data": d, "version": (doc.get("version") or 0) + 1}})
    print("restored")
