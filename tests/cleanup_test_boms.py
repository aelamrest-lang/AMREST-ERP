# Deletes only the BOM ids passed as args (test-created) via /api/erp/commit
import sys, uuid, requests
BASE = open('/app/frontend/.env').read().split('REACT_APP_BACKEND_URL=')[1].split()[0].rstrip('/')
t = requests.post(f"{BASE}/api/auth/login", json={"username": "admin", "password": "admin123"}).json()["token"]
h = {"Authorization": f"Bearer {t}"}
s = requests.get(f"{BASE}/api/erp/state", headers=h).json()
revs = s["revs"].get("boms", {})
ops = [{"kind": "delete", "coll": "boms", "rid": rid, "baseRev": revs[rid]} for rid in sys.argv[1:] if rid in revs]
r = requests.post(f"{BASE}/api/erp/commit", headers=h, json={"opId": str(uuid.uuid4()), "ops": ops})
print(r.status_code, r.text[:300])
