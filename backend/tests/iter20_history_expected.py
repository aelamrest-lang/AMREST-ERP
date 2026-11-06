"""Iter20: compute expected Material History (GRN IN / Issue OUT) for items from /api/erp/state. Usage: python3 iter20_history_expected.py [item_id]"""
import sys, requests
B = [l.split("=", 1)[1].strip() for l in open("/app/frontend/.env") if l.startswith("REACT_APP_BACKEND_URL=")][0] + "/api"
t = requests.post(f"{B}/auth/login", json={"username": "admin", "password": "admin123"}).json()["token"]
d = requests.get(f"{B}/erp/state", headers={"Authorization": "Bearer " + t}).json()["data"]


def txns(item):
    out = []
    for g in d.get("grns", []):
        for idx, r in enumerate(g.get("receivedItems", [])):
            if r.get("itemId") != item["id"] or not r.get("qty"):
                continue
            po = next((p for p in d["purchaseOrders"] if p["id"] == g.get("poId")), None)
            rate = float(next((x.get("rate") for x in (po or {}).get("items", []) if x.get("itemId") == item["id"]), 0) or 0)
            out.append(dict(key=f"g-{g['id']}-{idx}", dir="IN", date=g.get("date", ""), at=g.get("createdAt", ""), qty=float(r["qty"]),
                            po=(po or {}).get("number"), grn=g["number"], rate=rate, amount=rate * float(r["qty"])))
    for mi in d.get("materialIssues", []):
        for idx, l in enumerate(mi.get("lines", [])):
            if l.get("itemId") != item["id"] or not (float(l.get("issueQty") or 0) > 0):
                continue
            out.append(dict(key=f"i-{mi['id']}-{idx}", dir="OUT", date=mi.get("date", ""), at=mi.get("createdAt", ""), qty=float(l["issueQty"]),
                            issue=mi["number"], jc=mi.get("jobCardNumber"), issuedTo=mi.get("issuedTo")))
    out.sort(key=lambda x: (x["date"], x["at"]), reverse=True)
    bal = float(item.get("currentStock") or 0)
    for x in out:
        x["balance"] = bal
        bal -= x["qty"] if x["dir"] == "IN" else -x["qty"]
    return out


if len(sys.argv) > 1 and sys.argv[1] == "neg":
    neg = [(it["name"], round(min(x["balance"] - (x["qty"] if x["dir"] == "IN" else -x["qty"]) for x in tx), 2)) for it in d["items"] if (tx := txns(it))]
    bad = [n for n in neg if n[1] < -0.001]
    print("items with history:", len(neg), "items whose worked-back balance goes negative:", len(bad))
    for b in bad[:10]:
        print(b)
elif len(sys.argv) > 1:
    it = next(i for i in d["items"] if i["id"] == sys.argv[1])
    print("ITEM", it["id"], it["name"], "stock", it.get("currentStock"))
    for x in txns(it):
        print(x)
else:
    rows = []
    for it in d["items"]:
        tx = txns(it)
        if tx:
            rows.append((len(tx), sum(1 for x in tx if x["dir"] == "IN"), sum(1 for x in tx if x["dir"] == "OUT"), it["id"], it["name"], it.get("currentStock")))
    rows.sort(reverse=True)
    for r in rows[:15]:
        print(r)
    print("issues total", len(d.get("materialIssues", [])), "grns", len(d.get("grns", [])), "users", [u["name"] for u in d["users"]][:10], "operators", [o.get("name") for o in d.get("operators", [])][:10])
