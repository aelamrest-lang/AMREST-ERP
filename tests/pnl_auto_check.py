# Python replica of frontend/src/lib/pnlAuto.ts computeAutoPnl to cross-check P&L AUTO values for a month key
import sys, calendar
from pymongo import MongoClient
d = MongoClient("mongodb://localhost:27017")["test_database"].erp_state.find_one({})["data"]
po = {p["id"]: p for p in d["purchaseOrders"]}
def rate(g, iid):
    p = po.get(g["poId"]);
    if not p: return 0
    x = next((x for x in p["items"] if x["itemId"] == iid), None)
    try: return float(x.get("rate") or 0) if x else 0
    except: return 0
def grn_net(g):
    v = sum((r.get("qty") or 0) * rate(g, r["itemId"]) for r in g["receivedItems"])
    return v + (float(g.get("freight") or 0) if g.get("freightEnabled") else 0) + (float(g.get("packing") or 0) if g.get("packingEnabled") else 0)
def inv_tax(c):
    return sum(float(i.get("qty") or 0) * float(i.get("rate") or 0) for i in c.get("items") or []) + float(c.get("freight") or 0)
moves, rates = [], {}
for g in d["grns"]:
    for r in g["receivedItems"]:
        moves.append((g["date"], r["itemId"], r.get("qty") or 0))
        rt = rate(g, r["itemId"])
        if rt > 0: rates.setdefault(r["itemId"], []).append((g["date"], rt, r.get("qty") or 0))
for mi in d["materialIssues"]:
    for l in mi["lines"]:
        if l["issueQty"] > 0: moves.append((mi["date"], l["itemId"], -l["issueQty"]))
for b in d.get("sfgBatches") or []: moves.append((b["date"], b["itemId"], b.get("qtyProduced") or 0))
for c in d.get("sfgConsumptions") or []: moves.append((c["date"], c["itemId"], -(c.get("qty") or 0)))
for c in d["challans"]:
    for dd in c.get("dispatches") or []:
        for l in dd["lines"]:
            if l.get("itemId") and l.get("deducted"): moves.append((dd["date"], l["itemId"], -l["deducted"]))
moves.sort(key=lambda m: m[0], reverse=True)
def mend(k):
    y, m = map(int, k.split("-")); return f"{k}-{calendar.monthrange(y, m)[1]:02d}"
def rate_at(i, k):
    if i["category"] == "Finished Goods": return i.get("saleRate") or i.get("purchaseRate") or 0
    lst = rates.get(i["id"], []); inm = [r for r in lst if r[0].startswith(k)]
    if inm:
        q = sum(r[2] for r in inm); return sum(r[1] * r[2] for r in inm) / q if q > 0 else inm[0][1]
    before = sorted([r for r in lst if r[0] <= mend(k)], key=lambda r: r[0], reverse=True)
    return before[0][1] if before else (i.get("purchaseRate") or 0)
def value_at(k):
    end = mend(k); st = {i["id"]: float(i.get("currentStock") or 0) for i in d["items"]}
    for m in moves:
        if m[0] <= end: break
        st[m[1]] = st.get(m[1], 0) - m[2]
    return sum(max(0, st.get(i["id"], 0)) * rate_at(i, k) for i in d["items"])
k = sys.argv[1]
y, m = map(int, k.split("-")); pk = f"{y-1}-12" if m == 1 else f"{y}-{m-1:02d}"
print("opening", round(value_at(pk), 2), "closing", round(value_at(k), 2))
print("purchase", round(sum(grn_net(g) for g in d["grns"] if (g.get("date") or "").startswith(k)), 2))
print("sales", round(sum(inv_tax(c) for c in d["challans"] if (c.get("date") or "").startswith(k)), 2))
