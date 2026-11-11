# Probe ERP state for BOM testing: FG count, FG without BOM, RM/SFG items
import os, requests, json, sys
BASE = open('/app/frontend/.env').read().split('REACT_APP_BACKEND_URL=')[1].split()[0].rstrip('/')
t = requests.post(f"{BASE}/api/auth/login", json={"username": "admin", "password": "admin123"}).json()["token"]
s = requests.get(f"{BASE}/api/erp/state", headers={"Authorization": f"Bearer {t}"}).json()
d = s["data"]
items = d["items"]; boms = d["boms"]
fg = [i for i in items if i.get("category") == "Finished Goods"]
bomids = {b.get("productItemId") for b in boms}; bomnames = {b.get("name") for b in boms}
fg_no = [i for i in fg if i["id"] not in bomids and i["name"] not in bomnames]
so_names = {it.get("name") for so in d.get("salesOrders", []) for it in so.get("items", [])}
print("FG", len(fg), "BOMs", len(boms), "FG without BOM", len(fg_no), "FG not in SO", len([i for i in fg if i["name"] not in so_names]))
print("FG with BOM:", sum(1 for i in fg if i["id"] in bomids or i["name"] in bomnames))
mode = sys.argv[1] if len(sys.argv) > 1 else ""
if mode == "list":
    for i in fg_no[:10]: print("FG_NO_BOM", i["id"], i["name"], "inSO" if i["name"] in so_names else "noSO")
    for c in ["Raw Material", "Semi-Finished"]:
        for i in [x for x in items if x.get("category") == c][:3]: print(c, i["id"], i["name"], i.get("unit"))
    print("categories", {i.get("category") for i in items})
if mode == "bom":
    for name in sys.argv[2:]:
        for b in boms:
            if b.get("name") == name or b.get("productItemId") == name: print(json.dumps(b))
if mode == "testitems":
    for i in items:
        if i["name"].startswith("TEST_"): print(i["id"], i["name"], i["category"])
print("total items", len(items), "jobCards", len(d.get("jobCards", [])))
