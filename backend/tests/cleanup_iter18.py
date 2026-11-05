"""Cleanup for iteration_18 UI tests: delete TEST GRNs 390-395 (+audit, logs), restore item stock/saleRate/minStock and PO expectedDeliveryDate."""
import uuid, requests
B = [l.split("=", 1)[1].strip() for l in open("/app/frontend/.env") if l.startswith("REACT_APP_BACKEND_URL=")][0] + "/api"
t = requests.post(f"{B}/auth/login", json={"username": "admin", "password": "admin123"}).json()["token"]
H = {"Authorization": "Bearer " + t}
ITEM, ORIG_STOCK = "7c4dbe20-de09-46e7-8aba-b508f15a804b", 383.0
NUMS = [f"GRN-2026-{n}" for n in range(390, 396)]
s = requests.get(f"{B}/erp/state", headers=H).json(); d, revs = s["data"], s["revs"]
ops = [{"kind": "delete", "coll": "grns", "rid": g["id"], "baseRev": revs["grns"][g["id"]]} for g in d["grns"] if g["number"] in NUMS]
ops += [{"kind": "delete", "coll": "grnAudit", "rid": a["id"], "baseRev": revs["grnAudit"][a["id"]]} for a in d.get("grnAudit", []) if a.get("grnNumber") in NUMS]
ops += [{"kind": "delete", "coll": "logs", "rid": l["id"]} for l in d["logs"] if any(n in l.get("action", "") for n in NUMS) or l.get("action", "").startswith("Updated item: PVC Body Silica Gel Breather")]
it = next(i for i in d["items"] if i["id"] == ITEM)
ops.append({"kind": "inc", "coll": "items", "rid": ITEM, "delta": ORIG_STOCK - float(it["currentStock"])})
ops.append({"kind": "upsert", "coll": "items", "rid": ITEM, "baseRev": revs["items"][ITEM], "data": {**it, "saleRate": 0, "minStock": 0}})
po = next(p for p in d["purchaseOrders"] if p["number"] == "PO-2026-322")
ops.append({"kind": "upsert", "coll": "purchaseOrders", "rid": po["id"], "baseRev": revs["purchaseOrders"][po["id"]], "data": {**po, "expectedDeliveryDate": "2026-11-04"}})
print("ops", len(ops))
r = requests.post(f"{B}/erp/commit", headers=H, json={"opId": str(uuid.uuid4()), "ops": ops}); print("commit", r.status_code, r.text[:200])
d = requests.get(f"{B}/erp/state", headers=H).json()["data"]
it = next(i for i in d["items"] if i["id"] == ITEM); po = next(p for p in d["purchaseOrders"] if p["number"] == "PO-2026-322")
print("stock", it["currentStock"], "saleRate", it.get("saleRate"), "minStock", it.get("minStock"), "PO", po["status"], po["expectedDeliveryDate"], "left", [g["number"] for g in d["grns"] if g["number"] in NUMS])
