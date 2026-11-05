"""iter18 helper: create TEST GRN via API, B-edit fields via API, show state. Usage: create NUM | bedit NUM field value | show NUM | bgrn NUM (B creates GRN on item w/ +1)"""
import sys, uuid, json, requests
B = [l.split("=", 1)[1].strip() for l in open("/app/frontend/.env") if l.startswith("REACT_APP_BACKEND_URL=")][0] + "/api"
t = requests.post(f"{B}/auth/login", json={"username": "aaa@amrest.in", "password": "anwar@123"}).json()["token"]
H = {"Authorization": "Bearer " + t}
ITEM = "7c4dbe20-de09-46e7-8aba-b508f15a804b"
def st():
    return requests.get(f"{B}/erp/state", headers=H).json()
def commit(ops):
    r = requests.post(f"{B}/erp/commit", headers=H, json={"opId": str(uuid.uuid4()), "ops": ops}); return r.status_code, r.text[:300]
s = st(); d, revs = s["data"], s["revs"]
po = next(p for p in d["purchaseOrders"] if p["number"] == "PO-2026-322")
cmd = sys.argv[1]
if cmd in ("create", "bgrn"):
    num = sys.argv[2]
    tmpl = next(g for g in d["grns"] if g.get("receivedItems"))
    ri = {**tmpl["receivedItems"][0], "itemId": ITEM, "qty": 1}
    g = {**tmpl, "id": str(uuid.uuid4()), "number": num, "poId": po["id"], "receivedItems": [ri], "vendorInvoiceNo": "TEST_INV0", "vendorInvoiceAmount": 100}
    print(commit([{"kind": "inc", "coll": "items", "rid": ITEM, "delta": 1}, {"kind": "upsert", "coll": "grns", "rid": g["id"], "baseRev": None, "data": g}]), g["id"])
elif cmd == "bedit":
    coll, num, field, val = sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]
    rec = next(x for x in d[coll] if x.get("number") == num or x.get("id") == num)
    try: val = json.loads(val)
    except Exception: pass
    print(commit([{"kind": "upsert", "coll": coll, "rid": rec["id"], "baseRev": revs[coll][rec["id"]], "data": {**rec, field: val}}]))
elif cmd == "show":
    coll, num = sys.argv[2], sys.argv[3]
    rec = next((x for x in d[coll] if x.get("number") == num or x.get("id") == num), None)
    keys = sys.argv[4].split(",") if len(sys.argv) > 4 else None
    print(json.dumps({k: rec.get(k) for k in keys} if rec and keys else rec)[:600], "rev", revs[coll].get(rec["id"]) if rec else None)
