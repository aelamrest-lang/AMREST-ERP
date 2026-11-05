"""iter19: compute expected Production Daily Report totals from /api/erp/state. Usage: python iter19_daily_report_expected.py FROM TO [jcId] [stage] [operator]"""
import sys, requests
from collections import defaultdict
B = [l.split("=", 1)[1].strip() for l in open("/app/frontend/.env") if l.startswith("REACT_APP_BACKEND_URL=")][0] + "/api"
t = requests.post(f"{B}/auth/login", json={"username": "admin", "password": "admin123"}).json()["token"]
d = requests.get(f"{B}/erp/state", headers={"Authorization": "Bearer " + t}).json()["data"]
f, to = sorted(sys.argv[1:3])
jc = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] != "-" else None
st = sys.argv[4] if len(sys.argv) > 4 and sys.argv[4] != "-" else None
op = sys.argv[5] if len(sys.argv) > 5 and sys.argv[5] != "-" else None
es = [e for e in d["productionEntries"] if f <= e.get("date", "") <= to and (not jc or e["jobCardId"] == jc) and (not st or e["stage"] == st) and (not op or (e.get("operatorName") or "—") == op)]
g = defaultdict(float)
for e in es: g[(e["date"], e["jobCardId"], e["stage"], e.get("operatorName"))] += float(e.get("todayQty") or 0)
print("entries", len(es), "groups", len(g), "total", sum(g.values()))
print("dates", sorted({k[0] for k in g}, reverse=True)[:10])
jcs = {j["id"]: j.get("number") for j in d["jobCards"]}
for k, v in list(sorted(g.items(), reverse=True))[:8]: print(k[0], jcs.get(k[1]), k[1], k[2], k[3], v)
