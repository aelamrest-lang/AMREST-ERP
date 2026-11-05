"""Cleanup for iteration_19: delete 'Edited GRN GRN-2026-392' activity logs created by the UI tests (by id)."""
import uuid, requests
B = [l.split("=", 1)[1].strip() for l in open("/app/frontend/.env") if l.startswith("REACT_APP_BACKEND_URL=")][0] + "/api"
t = requests.post(f"{B}/auth/login", json={"username": "admin", "password": "admin123"}).json()["token"]
H = {"Authorization": "Bearer " + t}
d = requests.get(f"{B}/erp/state", headers=H).json()["data"]
ids = [l["id"] for l in d["logs"] if l.get("action", "").startswith("Edited GRN GRN-2026-392:") and l.get("timestamp", "") >= "2026-11-05T09:39"]
r = requests.post(f"{B}/erp/commit", headers=H, json={"opId": str(uuid.uuid4()), "ops": [{"kind": "delete", "coll": "logs", "rid": i} for i in ids]})
print("deleted", len(ids), r.status_code)
