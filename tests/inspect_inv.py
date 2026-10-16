import os, sys, json
from pymongo import MongoClient
env = dict(l.strip().split("=", 1) for l in open("/app/backend/.env") if "=" in l)
c = MongoClient(env["MONGO_URL"].strip('"'))[env["DB_NAME"].strip('"')]
doc = c.erp_state.find_one({"_id": "amrest-main"})
d = doc["data"]
print("version", doc.get("version"))
print("challans:", [(x["number"], len(x.get("dispatches") or []), [r["number"] for r in x.get("dispatches") or []]) for x in d["challans"]])
for so in d["salesOrders"]:
    if so["number"] in ("SO-2026-029", "SO-2026-022", "SO-2026-012"):
        print(so["number"], so["id"], so.get("status"), [(i["name"], i["qty"], i.get("rate")) for i in so["items"]])
sos = {s["id"]: s for s in d["salesOrders"]}
for jc in d["jobCards"]:
    so = sos.get(jc.get("salesOrderId"))
    if jc["number"] in ("JC-2026-007", "JC-2026-008", "JC-2026-016"):
        print(jc["number"], jc["product"], jc["qty"], jc.get("status"), so and so["number"], so and [(i["name"], i.get("rate")) for i in so["items"]])
for it in d["items"]:
    if it["name"].startswith("DTR 100") or it["name"] == "RADIATOR KEY":
        print("item", it["name"], it.get("currentStock"))
print("--- JCs")
for jc in d["jobCards"]:
    so = sos.get(jc.get("salesOrderId"))
    dr = sum(float(e.get("todayQty") or 0) for e in d.get("productionEntries", []) if e.get("jobCardId")==jc["id"] and e.get("stage")=="Dispatch Ready")
    if dr>0 or jc.get("status")=="Completed":
        print(jc["number"], "|", jc["product"], jc["qty"], jc.get("status"), jc.get("date"), "DR", dr, so and so["number"], so and len(so["items"]))
for so in d["salesOrders"]:
    if so["number"] in ("SO-2026-007","SO-2026-010","SO-2026-014"):
        print(so["number"], [(i["name"], i["qty"], i.get("rate")) for i in so["items"]])
