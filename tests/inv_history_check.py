# Independent Python replica of frontend/src/lib/stockHistory.ts (historical stock qty/value as of a date) for cross-checking Inventory date filter + P&L AUTO
import sys, json
from pymongo import MongoClient
d = MongoClient("mongodb://localhost:27017")["test_database"].erp_state.find_one({})["data"]
po = {p["id"]: p for p in d["purchaseOrders"]}
items = d["items"]
def rate(g, iid):
    p = po.get(g.get("poId"))
    if not p: return 0
    x = next((x for x in p["items"] if x["itemId"] == iid), None)
    try: return float(x.get("rate") or 0) if x else 0
    except Exception: return 0
moves, rates = [], {}
for g in d["grns"]:
    for r in g["receivedItems"]:
        moves.append((g.get("date") or "", r["itemId"], r.get("qty") or 0, "GRN"))
        rt = rate(g, r["itemId"])
        if rt > 0: rates.setdefault(r["itemId"], []).append((g.get("date") or "", rt))
for mi in d["materialIssues"]:
    for l in mi["lines"]:
        if (l.get("issueQty") or 0) > 0: moves.append((mi["date"], l["itemId"], -l["issueQty"], "Issue"))
for b in d.get("sfgBatches") or []: moves.append((b["date"], b["itemId"], b.get("qtyProduced") or 0, "SFGP"))
for c in d.get("sfgConsumptions") or []: moves.append((c["date"], c["itemId"], -(c.get("qty") or 0), "SFGC"))
for c in d["challans"]:
    for dd in c.get("dispatches") or []:
        for l in dd["lines"]:
            if l.get("itemId") and l.get("deducted"): moves.append((dd["date"], l["itemId"], -l["deducted"], "Disp"))

def stock_asof(date):
    st = {i["id"]: float(i.get("currentStock") or 0) for i in items}
    for m in moves:
        if m[0] > date: st[m[1]] = st.get(m[1], 0) - m[2]
    return st
def rate_asof(i, date):
    if i["category"] == "Finished Goods": return i.get("saleRate") or i.get("purchaseRate") or 0
    lst = sorted([r for r in rates.get(i["id"], []) if r[0] <= date], key=lambda r: r[0])[-3:]
    return sum(r[1] for r in lst) / len(lst) if lst else (i.get("purchaseRate") or 0)
def summary(date, cat=None):
    st = stock_asof(date)
    its = [i for i in items if not cat or i["category"] == cat]
    val = sum(st[i["id"]] * rate_asof(i, date) for i in its)
    low = sum(1 for i in its if st[i["id"]] <= (i.get("minStock") or 0))
    neg = sum(1 for i in its if st[i["id"]] < 0)
    return {"date": date, "cat": cat, "items": len(its), "value": round(val, 2), "low": low, "negative": neg}
def held(date):
    tot = 0
    for j in d["jobCards"]:
        if j["date"] > date or j["status"] == "Completed": continue
        for r in j["reservedItems"]:
            if not any(i["id"] == r["itemId"] for i in items): continue
            iss = sum(l["issueQty"] for mi in d["materialIssues"] if mi.get("jobCardId") == j["id"] and mi["date"] <= date for l in mi["lines"] if l["itemId"] == r["itemId"])
            tot += max(0, r["qty"] - iss)
    return round(tot, 2)
if __name__ == "__main__":
    mode = sys.argv[1]
    if mode == "sum":
        for dt in sys.argv[2:]:
            out = summary(dt); out["held"] = held(dt)
            for c in ["Raw Material", "Semi-Finished", "Finished Goods"]: out[c] = summary(dt, c)["value"]
            print(json.dumps(out))
    elif mode == "item":  # item <date> -> sample items with movements after date
        dt = sys.argv[2]; st = stock_asof(dt)
        moved = sorted({m[1] for m in moves if m[0] > dt})
        for iid in moved[:8]:
            i = next((x for x in items if x["id"] == iid), None)
            if i: print(json.dumps({"id": iid, "name": i["name"], "cur": i["currentStock"], "hist": st[iid], "rate": round(rate_asof(i, dt), 4)}))
    elif mode == "range":  # range from to
        f, t = sys.argv[2], sys.argv[3]
        import datetime
        pd = (datetime.date.fromisoformat(f) - datetime.timedelta(days=1)).isoformat()
        o, c = stock_asof(pd), stock_asof(t)
        inq, outq = {}, {}
        for m in moves:
            if f <= m[0] <= t:
                tgt = inq if m[2] >= 0 else outq; tgt[m[1]] = tgt.get(m[1], 0) + abs(m[2])
        for iid in sorted(set(inq) | set(outq))[:8]:
            print(json.dumps({"id": iid, "open": o[iid], "in": inq.get(iid, 0), "out": outq.get(iid, 0), "close": c[iid]}))
