"""One-off cleanup for iteration_17 UI tests: delete GRNs/audit/logs created via UI, revert stock & item sale rate."""
import uuid, requests
B = [l.split("=", 1)[1].strip() for l in open("/app/frontend/.env") if l.startswith("REACT_APP_BACKEND_URL=")][0] + "/api"
t = requests.post(f"{B}/auth/login", json={"username": "admin", "password": "admin123"}).json()["token"]
H = {"Authorization": "Bearer " + t}
ITEM, ORIG_STOCK = "7c4dbe20-de09-46e7-8aba-b508f15a804b", 383.0
NUMS = [f"GRN-2026-{n}" for n in range(380, 389)]
s = requests.get(f"{B}/erp/state", headers=H).json()
d, revs = s["data"], s["revs"]
ops = []
for g in d["grns"]:
    if g["number"] in NUMS:
        ops.append({"kind": "delete", "coll": "grns", "rid": g["id"], "baseRev": revs["grns"][g["id"]]})
for a in d.get("grnAudit", []):
    if a.get("grnNumber") in NUMS:
        ops.append({"kind": "delete", "coll": "grnAudit", "rid": a["id"], "baseRev": revs["grnAudit"][a["id"]]})
for l in d["logs"]:
    act = l.get("action", "")
    if any(n in act for n in NUMS) or act.startswith("Updated item: PVC Body Silica Gel Breather"):
        ops.append({"kind": "delete", "coll": "logs", "rid": l["id"]})
it = next(i for i in d["items"] if i["id"] == ITEM)
ops.append({"kind": "inc", "coll": "items", "rid": ITEM, "delta": ORIG_STOCK - float(it["currentStock"])})
if it.get("saleRate") == 1:
    ops.append({"kind": "upsert", "coll": "items", "rid": ITEM, "baseRev": revs["items"][ITEM], "data": {**it, "saleRate": 0}})
print("ops:", {k: sum(1 for o in ops if o.get("coll") == k) for k in ("grns", "grnAudit", "logs", "items")})
r = requests.post(f"{B}/erp/commit", headers=H, json={"opId": str(uuid.uuid4()), "ops": ops})
print("commit", r.status_code, r.text[:200])
s = requests.get(f"{B}/erp/state", headers=H).json()["data"]
it = next(i for i in s["items"] if i["id"] == ITEM)
po = next(p for p in s["purchaseOrders"] if p["number"] == "PO-2026-322")
print("stock", it["currentStock"], "saleRate", it.get("saleRate"), "PO status", po["status"], "left GRNs", [g["number"] for g in s["grns"] if g["number"] in NUMS])
