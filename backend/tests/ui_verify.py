"""Helper used by the UI test run: verify / clean up records created through the UI. Usage: python3 ui_verify.py verify|cleanup <GRN numbers comma> [item_id] [expected_stock]"""
import json, sys, uuid, requests
B = [l.split("=", 1)[1].strip() for l in open("/app/frontend/.env") if l.startswith("REACT_APP_BACKEND_URL=")][0] + "/api"
t = requests.post(f"{B}/auth/login", json={"username": "admin", "password": "admin123"}).json()["token"]
H = {"Authorization": "Bearer " + t}
s = requests.get(f"{B}/erp/state", headers=H).json()
d, revs = s["data"], s["revs"]
mode, nums = sys.argv[1], sys.argv[2].split(",")
grns = [g for g in d["grns"] if g["number"] in nums]
print("GRNs found:", sorted(g["number"] for g in grns), "count", len(grns), "dup numbers:", len(grns) != len({g["number"] for g in grns}))
print("ids:", {g["number"]: g["id"] for g in grns})
allnums = [g["number"] for g in d["grns"]]
print("global duplicate GRN numbers:", sorted({n for n in allnums if allnums.count(n) > 1}))
logs = [l for l in d["logs"] if any(f"GRN {n} " in l.get("action", "") for n in nums)]
print("activity logs for these GRNs:", len(logs), [l["action"][:40] for l in logs])
audit = [a for a in d.get("grnAudit", []) if a.get("grnNumber") in nums]
print("grnAudit entries:", len(audit))
if len(sys.argv) > 3:
    it = next(i for i in d["items"] if i["id"] == sys.argv[3])
    print("item stock:", it["currentStock"], "expected:", sys.argv[4] if len(sys.argv) > 4 else "?")
if mode == "cleanup":
    ops, deltas = [], {}
    for g in grns:
        ops.append({"kind": "delete", "coll": "grns", "rid": g["id"], "baseRev": revs["grns"][g["id"]]})
        for r in g.get("receivedItems", []):
            deltas[r["itemId"]] = deltas.get(r["itemId"], 0) - float(r["qty"])
    for a in audit:
        ops.append({"kind": "delete", "coll": "grnAudit", "rid": a["id"], "baseRev": revs.get("grnAudit", {}).get(a["id"])})
    for l in logs:
        ops.append({"kind": "delete", "coll": "logs", "rid": l["id"]})
    for k, v in deltas.items():
        ops.append({"kind": "inc", "coll": "items", "rid": k, "delta": v})
    r = requests.post(f"{B}/erp/commit", headers=H, json={"opId": str(uuid.uuid4()), "ops": ops})
    print("cleanup", r.status_code, r.text[:300], "stock deltas", deltas)
