# Independent recomputation of GRN dashboard cards from Mongo erp_state (oracle for UI checks)
import sys
from pymongo import MongoClient
from datetime import date

c = MongoClient("mongodb://localhost:27017")["test_database"]
d = c.erp_state.find_one({"_id": {"$exists": True}})["data"]
pos = {p["id"]: p for p in d["purchaseOrders"]}
grns = d["grns"]


def f(i):
    return (float(i.get("rate") or 0)) * (1 + float(i.get("gst") or 0) / 100)


def rec(pid):
    r = {}
    for g in grns:
        if g["poId"] == pid:
            for x in g["receivedItems"]:
                r[x["itemId"]] = r.get(x["itemId"], 0) + (x.get("qty") or 0)
    return r


def receipt(p):
    r = rec(p["id"])
    pend = sum(max(0, i["qty"] - r.get(i["itemId"], 0)) * f(i) for i in p["items"])
    full = len(p["items"]) > 0 and all(r.get(i["itemId"], 0) >= i["qty"] for i in p["items"])
    anyr = any(r.get(i["itemId"], 0) > 0 for i in p["items"])
    return pend, full, anyr


def gg(g):
    p = pos.get(g["poId"])
    s = 0
    for ri in g["receivedItems"]:
        line = next((x for x in (p or {}).get("items", []) if x["itemId"] == ri["itemId"]), None)
        s += ri["qty"] * (f(line) if line else 0)
    if g.get("freightEnabled"):
        s += float(g.get("freight") or 0) * (1 + float(g.get("freightGst") or 0) / 100)
    if g.get("packingEnabled"):
        s += float(g.get("packing") or 0) * (1 + float(g.get("packingGst") or 0) / 100)
    return s


ranges = {"all": ("0000", "9999"), "month": ("2026-10-01", "2026-10-16"), "lastmonth": ("2026-09-01", "2026-09-30"),
          "3m": ("2026-07-16", "2026-10-16"), "6m": ("2026-04-16", "2026-10-16")}
for k, (a, b) in ranges.items():
    inr = lambda x: bool(x) and a <= x <= b
    tot = [g for g in grns if inr(g["date"])]
    comp = [g for g in tot if g["poId"] in pos and receipt(pos[g["poId"]])[1]]
    op = [p for p in pos.values() if p["status"] not in ("Cancelled", "Draft") and inr(p["date"])]
    pen = [p for p in op if not receipt(p)[2] and not receipt(p)[1]]
    par = [p for p in op if receipt(p)[2] and not receipt(p)[1]]
    print(k, f"total={len(tot)}/{sum(map(gg, tot)):.2f} completed={len(comp)}/{sum(map(gg, comp)):.2f} "
             f"pending={len(pen)}/{sum(receipt(p)[0] for p in pen):.2f} partial={len(par)}/{sum(receipt(p)[0] for p in par):.2f}")
from collections import Counter
print("dup GRN numbers:", [n for n, c2 in Counter(g["number"] for g in grns).items() if c2 > 1])
print("dup PO numbers:", [n for n, c2 in Counter(p["number"] for p in pos.values()).items() if c2 > 1])
print("PO statuses:", Counter(p["status"] for p in pos.values()))
print("orphan GRNs:", [g["number"] for g in grns if g["poId"] not in pos])
if len(sys.argv) > 1:
    for p in pos.values():
        if p["number"] == sys.argv[1]:
            print(p["number"], p["status"], p["date"], [(i["itemId"], i["qty"], i["rate"], i.get("gst")) for i in p["items"]], rec(p["id"]), receipt(p))
            print([(g["number"], g["date"], g["receivedItems"]) for g in grns if g["poId"] == p["id"]])
op = [p for p in pos.values() if p["status"] not in ("Cancelled", "Draft")]
print("pending by status:", Counter(p["status"] for p in op if not receipt(p)[2]))
print("partial by status:", Counter(p["status"] for p in op if receipt(p)[2] and not receipt(p)[1]))
print("pending sample (Completed/Received status, no GRN):", [p["number"] for p in op if not receipt(p)[2] and p["status"] in ("Completed","Received")][:5])
print("pending candidates for test (Approved, 0 recv, small):", [(p["number"], p["date"], len(p["items"])) for p in op if not receipt(p)[2] and p["status"]=="Approved"][:8])
