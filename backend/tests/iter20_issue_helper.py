"""Iter20: show/cleanup a TEST material issue created via UI. Usage: python3 iter20_issue_helper.py show|cleanup MIS-NUMBER"""
import sys, uuid, requests
B = [l.split("=", 1)[1].strip() for l in open("/app/frontend/.env") if l.startswith("REACT_APP_BACKEND_URL=")][0] + "/api"
t = requests.post(f"{B}/auth/login", json={"username": "admin", "password": "admin123"}).json()["token"]
H = {"Authorization": "Bearer " + t}
s = requests.get(f"{B}/erp/state", headers=H).json()
d, revs = s["data"], s["revs"]
mode, num = sys.argv[1], sys.argv[2]
mi = [m for m in d["materialIssues"] if m["number"] == num and "TEST_" in (m.get("remarks") or "")]
for m in mi:
    print("issue", m["id"], m["number"], "issuedTo", m.get("issuedTo"), "remarks", m.get("remarks"))
    for l in m["lines"]:
        it = next(i for i in d["items"] if i["id"] == l["itemId"])
        print("  line", l["itemId"], it["name"], "qty", l["issueQty"], "item stock", it["currentStock"])
if mode == "cleanup" and mi:
    ops = []
    for m in mi:
        ops.append({"kind": "delete", "coll": "materialIssues", "rid": m["id"], "baseRev": revs["materialIssues"][m["id"]]})
        for l in m["lines"]:
            ops.append({"kind": "inc", "coll": "items", "rid": l["itemId"], "delta": float(l["issueQty"])})
    for l in d["logs"]:
        if f"Material Issue {num} " in l.get("action", ""):
            ops.append({"kind": "delete", "coll": "logs", "rid": l["id"]})
    r = requests.post(f"{B}/erp/commit", headers=H, json={"opId": str(uuid.uuid4()), "ops": ops})
    print("cleanup", r.status_code, r.text[:200])
