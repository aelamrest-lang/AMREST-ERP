"""iter19: create/cleanup TEST production entries for Daily Report. Usage: create | cleanup"""
import sys, uuid, json, requests
B = [l.split("=", 1)[1].strip() for l in open("/app/frontend/.env") if l.startswith("REACT_APP_BACKEND_URL=")][0] + "/api"
t = requests.post(f"{B}/auth/login", json={"username": "admin", "password": "admin123"}).json()["token"]
H = {"Authorization": "Bearer " + t}
s = requests.get(f"{B}/erp/state", headers=H).json(); d, revs = s["data"], s["revs"]
IDS_FILE = "/tmp/iter19_pe_ids.json"
if sys.argv[1] == "create":
    tmpl = next(e for e in d["productionEntries"] if e["jobCardId"] == "3531b7cd-3189-4ed8-9266-ba92b6b1e47a")
    spec = [("2026-11-05", "TEST_OpA", 5), ("2026-11-05", "TEST_OpA", 7), ("2026-11-05", "TEST_OpB", 3), ("2026-11-04", "TEST_OpA", 4)]
    ops, ids = [], []
    for date, op, q in spec:
        e = {**tmpl, "id": str(uuid.uuid4()), "date": date, "operatorName": op, "todayQty": q, "createdAt": date + "T08:00:00.000Z"}
        ids.append(e["id"]); ops.append({"kind": "upsert", "coll": "productionEntries", "rid": e["id"], "baseRev": None, "data": e})
    r = requests.post(f"{B}/erp/commit", headers=H, json={"opId": str(uuid.uuid4()), "ops": ops}); print(r.status_code, r.text[:200])
    json.dump(ids, open(IDS_FILE, "w")); print("ids", ids, "stage", tmpl["stage"])
else:
    ids = json.load(open(IDS_FILE))
    ops = [{"kind": "delete", "coll": "productionEntries", "rid": i, "baseRev": revs["productionEntries"].get(i)} for i in ids if i in revs["productionEntries"]]
    r = requests.post(f"{B}/erp/commit", headers=H, json={"opId": str(uuid.uuid4()), "ops": ops}); print("cleanup", r.status_code, r.text[:200])
    d = requests.get(f"{B}/erp/state", headers=H).json()["data"]
    print("left", [e["id"] for e in d["productionEntries"] if e["id"] in ids])
