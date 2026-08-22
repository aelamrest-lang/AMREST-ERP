import { useState, useMemo } from "react";
import { useStore, uid } from "../lib/store";
import { Card, CardHeader, Button, Input, Select, Label, Modal, Table, Th, Td, Badge, Empty } from "../components/ui";
import { BarChart } from "../components/charts";
import { FinishedGoodCombobox } from "../components/FinishedGoodCombobox";
import { NewFinishedGoodModal } from "../components/NewFinishedGoodModal";
import type { SalesOrder, DeliverySchedule } from "../lib/types";
import { IconPlus, IconEdit, IconTrash, IconPrint, IconCheck } from "../components/icons";
import { calcDocTotalsWithFreight, fmtINR, nextNumber, printArea, professionalDocument, todayISO } from "../lib/utils";
import { userCan } from "../lib/permissions";
import {
  totalOrderQty, totalScheduledQty, totalDeliveredQty, unscheduledBalance,
  scheduleStatus, orderDelayInfo, canManageSchedule,
  orderQtyForItem, scheduledQtyForItem, deliveredQtyForItem, unscheduledBalanceForItem, schedulesForItem,
} from "../lib/delivery";

const SO_STATUSES: SalesOrder["status"][] = ["Pending", "Confirmed", "In Production", "Dispatched", "Delivered"];
const GST_OPTIONS = [0, 5, 12, 18, 28];

export function SalesOrders() {
  const { db, setDB, currentUser, log } = useStore();
  const isAdmin = currentUser?.role === "admin";
  const canCreate = userCan(currentUser, "salesorders", "create");
  const canEdit = userCan(currentUser, "salesorders", "edit");
  const canDelete = userCan(currentUser, "salesorders", "delete");
  const canPrint = userCan(currentUser, "salesorders", "print");
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<SalesOrder | null>(null);
  const [newItemForRow, setNewItemForRow] = useState<{ idx: number; seed: string } | null>(null);
  const [viewOrder, setViewOrder] = useState<SalesOrder | null>(null);

  const list = useMemo(() => {
    const arr = isAdmin ? db.salesOrders : db.salesOrders.filter(o => o.ownerId === currentUser?.id);
    return arr.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [db.salesOrders, isAdmin, currentUser]);

  // ---- SO Summary (auto-derived from Delivery Challans) ----
  const summary = useMemo(() => {
    let inHandCount = 0, inHandQty = 0, inHandValue = 0;
    let pendingCount = 0, pendingQty = 0, pendingValue = 0;
    let completedCount = 0, completedQty = 0, completedValue = 0;

    for (const o of list) {
      const orderedQty = o.items.reduce((s, i) => s + (Number(i.qty) || 0), 0);
      const orderedValue = o.items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.rate) || 0) * (1 + (Number(i.gst) || 0) / 100), 0) + (Number(o.freight) || 0);

      // Dispatched from Delivery Challans linked to this SO
      const dcs = db.challans.filter(c => c.salesOrderId === o.id);
      const dispatchedQty = dcs.reduce((s, c) => s + (c.items || []).reduce((a, i) => a + (Number(i.qty) || 0), 0), 0);
      const dispatchedValue = dcs.reduce((s, c) => s + (c.items || []).reduce((a, i) => a + (Number(i.qty) || 0) * (Number(i.rate) || 0) * (1 + (Number(i.gst) || 0) / 100), 0) + (Number(c.freight) || 0), 0);

      const balanceQty = Math.max(0, orderedQty - dispatchedQty);
      const balanceValue = Math.max(0, orderedValue - dispatchedValue);
      // An SO is Completed when the full ordered qty has been dispatched,
      // OR when a user manually marks its status as "Delivered".
      const isCompleted = (orderedQty > 0 && balanceQty === 0) || o.status === "Delivered";

      if (isCompleted) {
        completedCount += 1;
        completedQty += orderedQty;
        completedValue += orderedValue;
      } else {
        inHandCount += 1;
        inHandQty += orderedQty;
        inHandValue += orderedValue;
        if (balanceQty > 0) {
          pendingCount += 1;
          pendingQty += balanceQty;
          pendingValue += balanceValue;
        }
      }
    }
    return { inHandCount, inHandQty, inHandValue, pendingCount, pendingQty, pendingValue, completedCount, completedQty, completedValue };
  }, [list, db.challans]);

  // ---- Monthly Sales (from DCs) + Top Customers (from DCs) ----
  // Filter to SOs owned by user (if not admin), then use those SO IDs for DC filtering.
  const ownedSoIds = useMemo(() => new Set(list.map(o => o.id)), [list]);
  const relevantChallans = useMemo(
    () => db.challans.filter(c => ownedSoIds.has(c.salesOrderId) || (isAdmin && !c.salesOrderId)),
    [db.challans, ownedSoIds, isAdmin]
  );

  const [customerMetric, setCustomerMetric] = useState<"value" | "qty">("value");

  const now = new Date();
  const monthBuckets = useMemo(() => {
    const arr: { key: string; label: string; date: Date }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      arr.push({
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
        label: d.toLocaleString("en", { month: "short" }),
        date: d,
      });
    }
    return arr;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const monthlySalesData = useMemo(() => {
    return monthBuckets.map(m => {
      const total = relevantChallans
        .filter(c => c.date && c.date.slice(0, 7) === m.key)
        .reduce((s, c) => {
          const items = (c.items || []);
          const sub = items.reduce((a, b) => a + (Number(b.qty) || 0) * (Number(b.rate) || 0), 0);
          const gst = items.reduce((a, b) => a + (Number(b.qty) || 0) * (Number(b.rate) || 0) * ((Number(b.gst) || 0) / 100), 0);
          return s + sub + gst + (Number(c.freight) || 0);
        }, 0);
      return { label: m.label, value: Math.round(total / 1000) };
    });
  }, [monthBuckets, relevantChallans]);

  const topCustomersFull = useMemo(() => {
    // Based on SALES ORDERS (ordered qty × rate + freight)
    const map = new Map<string, { customerId: string; name: string; qty: number; value: number; soCount: number }>();
    list.forEach(o => {
      const qty = o.items.reduce((a, b) => a + (Number(b.qty) || 0), 0);
      const val = o.items.reduce((a, b) => a + (Number(b.qty) || 0) * (Number(b.rate) || 0), 0) + (Number(o.freight) || 0);
      const name = db.parties.find(p => p.id === o.customerId)?.name || "—";
      const existing = map.get(o.customerId);
      if (existing) { existing.qty += qty; existing.value += val; existing.soCount += 1; }
      else map.set(o.customerId, { customerId: o.customerId, name, qty, value: val, soCount: 1 });
    });
    return Array.from(map.values())
      .sort((a, b) => customerMetric === "value" ? b.value - a.value : b.qty - a.qty)
      .slice(0, 10);
  }, [list, db.parties, customerMetric]);

  const topCustomers = useMemo(() =>
    topCustomersFull.map(x => ({
      label: x.name.length > 14 ? x.name.slice(0, 14) + "…" : x.name,
      value: customerMetric === "value" ? Math.round(x.value / 1000) : x.qty,
    })),
    [topCustomersFull, customerMetric]);

  const [customerDrill, setCustomerDrill] = useState<string | null>(null); // customerId
  const [monthDrill, setMonthDrill] = useState<string | null>(null); // YYYY-MM key

  const customers = db.parties.filter(p => p.type === "customer" && (isAdmin || p.ownerId === currentUser?.id));

  const blank = (): SalesOrder => ({
    id: "", number: nextNumber("SO", db.salesOrders), date: todayISO(), customerId: customers[0]?.id || "",
    items: [{ name: "", qty: 1, rate: 0, gst: 18 }],
    deliveryDate: "", schedules: [], status: "Confirmed",
    ownerId: currentUser!.id, createdAt: new Date().toISOString(),
  });
  const [form, setForm] = useState<SalesOrder>(blank());

  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});
  const canManage = canManageSchedule(form, currentUser);

  const openNew = () => { setEdit(null); setForm(blank()); setOpen(true); };
  const openEdit = (o: SalesOrder) => {
    setEdit(o);
    // Migrate legacy schedules: if SO has 2+ items and any schedule lacks itemName,
    // auto-assign that slot to the first item so it appears in an item-scoped section.
    const items = o.items.map(i => ({ ...i }));
    const firstName = items[0]?.name || "";
    const schedules = (o.schedules || []).map(s => ({
      ...s,
      itemName: items.length > 1 && !s.itemName && firstName ? firstName : s.itemName,
    }));
    setForm({ ...o, items, schedules });
    setOpen(true);
  };

  const save = () => {
    // Validate schedules don't exceed order qty (per-item when multi-item)
    if (form.items.length > 1) {
      for (const it of form.items) {
        if (!it.name) continue;
        const ordered = orderQtyForItem(form, it.name);
        const sched = scheduledQtyForItem(form, it.name);
        if (sched > ordered) {
          alert(`"${it.name}": Scheduled qty (${sched}) cannot exceed ordered qty (${ordered}). Please adjust.`);
          return;
        }
      }
    } else {
      const orderQty = totalOrderQty(form);
      const scheduled = totalScheduledQty(form);
      if (scheduled > orderQty) {
        alert(`Scheduled quantity (${scheduled}) cannot exceed total order quantity (${orderQty}). Please adjust.`);
        return;
      }
    }
    if (edit) setDB(d => ({...d, salesOrders: d.salesOrders.map(x => x.id === edit.id ? form : x)}));
    else setDB(d => ({...d, salesOrders: [{...form, id: uid()}, ...d.salesOrders]}));
    log(`${edit ? "Updated" : "Created"} sales order ${form.number}`, "Sales Order");
    setOpen(false);
  };

  const remove = (o: SalesOrder) => {
    if (!window.confirm(`Delete ${o.number}?`)) return;
    setDB(d => ({...d, salesOrders: d.salesOrders.filter(x => x.id !== o.id)}));
    log(`Deleted SO ${o.number}`, "Sales Order");
  };

  const updateItem = (i: number, key: string, val: any) => setForm(f => ({...f, items: f.items.map((it, idx) => idx === i ? {...it, [key]: key === "name" ? val : Number(val)} : it)}));
  const pickFinishedGood = (i: number, fg: { name: string; saleRate: number; gstRate: number }) => {
    setForm(f => ({
      ...f,
      items: f.items.map((it, idx) => idx === i ? {
        ...it,
        name: fg.name,
        rate: fg.saleRate || it.rate || 0,
        gst: fg.gstRate ?? it.gst,
      } : it),
    }));
  };
  const addItem = () => setForm(f => ({...f, items: [...f.items, { name: "", qty: 1, rate: 0, gst: 18 }]}));
  const delItem = (i: number) => setForm(f => ({...f, items: f.items.filter((_, idx) => idx !== i)}));
  const totals = calcDocTotalsWithFreight(form.items, Number(form.freight) || 0);
  const grandTotal = totals.total;

  // --- Schedule handlers ---
  const addSchedule = (itemName?: string) => {
    const remaining = itemName
      ? unscheduledBalanceForItem(form, itemName)
      : unscheduledBalance(form);
    if (remaining <= 0) return alert(itemName ? `All qty for "${itemName}" is already scheduled.` : "All order quantity is already scheduled.");
    setForm(f => ({
      ...f,
      schedules: [...(f.schedules || []), { id: uid(), date: "", qty: remaining, deliveredQty: 0, ...(itemName ? { itemName } : {}) }],
    }));
  };
  const updateSchedule = (id: string, patch: Partial<DeliverySchedule>) => {
    setForm(f => ({
      ...f,
      schedules: (f.schedules || []).map(s => s.id === id ? { ...s, ...patch } : s),
    }));
  };
  const removeSchedule = (id: string) => setForm(f => ({
    ...f, schedules: (f.schedules || []).filter(s => s.id !== id),
  }));
  const splitEvenly = (n: number, itemName?: string) => {
    const itemQty = itemName ? orderQtyForItem(form, itemName) : totalOrderQty(form);
    if (!itemQty) return alert("Add order items first.");
    if (n < 1) return;
    const perSlot = Math.floor(itemQty / n);
    const remainder = itemQty - perSlot * n;
    const today = new Date();
    const newSlots: DeliverySchedule[] = [];
    for (let i = 0; i < n; i++) {
      const d = new Date(today.getFullYear(), today.getMonth() + i, 15);
      newSlots.push({
        id: uid(),
        date: d.toISOString().slice(0, 10),
        qty: perSlot + (i === n - 1 ? remainder : 0),
        deliveredQty: 0,
        ...(itemName ? { itemName } : {}),
      });
    }
    setForm(f => {
      const others = itemName
        ? (f.schedules || []).filter(s => (s.itemName || "") !== itemName)
        : [];
      return { ...f, schedules: [...others, ...newSlots] };
    });
  };

  const printSO = (o: SalesOrder) => {
    const cust = db.parties.find(x => x.id === o.customerId);
    const t = calcDocTotalsWithFreight(o.items, Number(o.freight) || 0);
    const fr = t.freight;
    const grand = t.total;
    const scheduleRows = (o.schedules || []).map(s => {
      const st = scheduleStatus(s);
      return `<tr>
        <td>${s.date || "—"}</td>
        <td style="text-align:right">${s.qty}</td>
        <td style="text-align:right">${s.deliveredQty || 0}</td>
        <td style="text-align:right">${st.pending}</td>
        <td>${st.isCompleted ? "Completed" : st.isOverdue ? `${st.delayDays} Days Delayed` : "On Track"}</td>
      </tr>`;
    }).join("");
    const body = `
      <div class="box"><b>Bill To:</b><br/>${cust?.name || ""}<br/>${cust?.address || ""}${cust?.city ? `, ${cust.city}` : ""}<br/>GST: ${cust?.gst || "N/A"}</div>
      <div class="box"><span class="badge">${o.status}</span> &nbsp; <b>Delivery Date:</b> ${o.deliveryDate || "TBD"}</div>
      <table><thead><tr><th>Item</th><th style="text-align:right">Qty</th><th style="text-align:right">Rate</th><th style="text-align:right">GST%</th><th style="text-align:right">Amount</th></tr></thead>
      <tbody>${o.items.map(i => `<tr><td>${i.name}</td><td style="text-align:right">${i.qty}</td><td style="text-align:right">${fmtINR(i.rate)}</td><td style="text-align:right">${i.gst}%</td><td style="text-align:right">${fmtINR(i.qty * i.rate)}</td></tr>`).join("")}</tbody></table>
      <table style="margin-top:8px;max-width:340px;margin-left:auto">
        <tr><td>Sub Total</td><td style="text-align:right">${fmtINR(t.sub)}</td></tr>
        <tr><td>Freight</td><td style="text-align:right">${fmtINR(fr)}</td></tr>
        <tr><td>GST</td><td style="text-align:right">${fmtINR(t.gst)}</td></tr>
        <tr><td><b>Total</b></td><td style="text-align:right"><b>${fmtINR(grand)}</b></td></tr>
      </table>
      ${scheduleRows ? `<div class="section-title" style="margin-top:14px">Delivery Schedule</div>
        <table>
          <thead><tr><th>Date</th><th style="text-align:right">Scheduled</th><th style="text-align:right">Delivered</th><th style="text-align:right">Pending</th><th>Status</th></tr></thead>
          <tbody>${scheduleRows}</tbody>
        </table>` : ""}
    `;
    const html = professionalDocument(db.settings, { title: "Sales Order", number: o.number, date: o.date, body, accent: "#059669" });
    printArea(html, o.number);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div><h1 className="text-2xl font-bold">Sales Orders</h1><p className="text-sm text-slate-500">Confirmed orders, delivery schedules and dispatch tracking</p></div>
        {canCreate && <Button onClick={openNew} data-testid="new-so-btn"><IconPlus size={14}/> New Sales Order</Button>}
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-gradient-to-br from-indigo-50 to-white dark:from-indigo-900/30 dark:to-slate-900 p-4" data-testid="so-summary-in-hand">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-indigo-700 dark:text-indigo-300 font-semibold">Total Orders in Hand</div>
              <div className="text-3xl font-bold text-indigo-800 dark:text-indigo-200 mt-1" data-testid="so-summary-in-hand-count">{summary.inHandCount}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">Active orders not yet fully dispatched</div>
            </div>
            <div className="text-2xl" aria-hidden>📥</div>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-indigo-100 dark:border-indigo-800/60">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Order Qty</div>
              <div className="text-base font-semibold text-slate-800 dark:text-slate-100" data-testid="so-summary-in-hand-qty">{summary.inHandQty} <span className="text-[10px] text-slate-500 font-normal">Nos</span></div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Order Value</div>
              <div className="text-base font-semibold text-slate-800 dark:text-slate-100" data-testid="so-summary-in-hand-value">{fmtINR(summary.inHandValue)}</div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-gradient-to-br from-amber-50 to-white dark:from-amber-900/30 dark:to-slate-900 p-4" data-testid="so-summary-pending">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-amber-700 dark:text-amber-300 font-semibold">Pending Orders</div>
              <div className="text-3xl font-bold text-amber-800 dark:text-amber-200 mt-1" data-testid="so-summary-pending-count">{summary.pendingCount}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">Orders with remaining balance qty</div>
            </div>
            <div className="text-2xl" aria-hidden>⏳</div>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-amber-100 dark:border-amber-800/60">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Balance Qty</div>
              <div className="text-base font-semibold text-slate-800 dark:text-slate-100" data-testid="so-summary-pending-qty">{summary.pendingQty} <span className="text-[10px] text-slate-500 font-normal">Nos</span></div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Balance Value</div>
              <div className="text-base font-semibold text-slate-800 dark:text-slate-100" data-testid="so-summary-pending-value">{fmtINR(summary.pendingValue)}</div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-900/30 dark:to-slate-900 p-4" data-testid="so-summary-completed">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-emerald-700 dark:text-emerald-300 font-semibold">Completed Orders</div>
              <div className="text-3xl font-bold text-emerald-800 dark:text-emerald-200 mt-1" data-testid="so-summary-completed-count">{summary.completedCount}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">Full ordered qty dispatched</div>
            </div>
            <div className="text-2xl" aria-hidden>✅</div>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-emerald-100 dark:border-emerald-800/60">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Delivered Qty</div>
              <div className="text-base font-semibold text-slate-800 dark:text-slate-100" data-testid="so-summary-completed-qty">{summary.completedQty} <span className="text-[10px] text-slate-500 font-normal">Nos</span></div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Delivered Value</div>
              <div className="text-base font-semibold text-slate-800 dark:text-slate-100" data-testid="so-summary-completed-value">{fmtINR(summary.completedValue)}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Monthly Sales (₹ thousands)"
            subtitle="Value of Delivery Challans dispatched · click any bar to drill in"
          />
          <div className="p-4">
            <BarChart
              data={monthlySalesData}
              color="#6366f1"
              onBarClick={(i) => setMonthDrill(monthBuckets[i].key)}
            />
          </div>
        </Card>
        <Card>
          <CardHeader
            title={customerMetric === "value" ? "Top 10 Customers (₹K)" : "Top 10 Customers (Nos)"}
            subtitle="From Sales Orders · click any bar for details"
            right={
              <div className="flex items-center gap-1 text-[11px]">
                <button
                  type="button"
                  onClick={() => setCustomerMetric("value")}
                  className={"px-2 py-0.5 rounded " + (customerMetric === "value" ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300")}
                  data-testid="so-top-customers-metric-value"
                >Value</button>
                <button
                  type="button"
                  onClick={() => setCustomerMetric("qty")}
                  className={"px-2 py-0.5 rounded " + (customerMetric === "qty" ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300")}
                  data-testid="so-top-customers-metric-qty"
                >Qty</button>
              </div>
            }
          />
          <div className="p-4">
            {topCustomers.length ? (
              <BarChart
                data={topCustomers}
                color="#f59e0b"
                onBarClick={(i) => setCustomerDrill(topCustomersFull[i].customerId)}
              />
            ) : <Empty title="No Delivery Challans yet" />}
          </div>
        </Card>
      </div>

      <Card>
        <Table>
          <thead><tr><Th>#</Th><Th>Date</Th><Th>Customer</Th><Th>Product(s) &amp; Qty</Th><Th>Delivery</Th><Th>Schedule</Th><Th>Total</Th><Th>Status</Th><Th></Th></tr></thead>
          <tbody>
            {list.map(o => {
              const t = calcDocTotalsWithFreight(o.items, Number(o.freight) || 0);
              const totalWithFreight = t.total;
              const oq = totalOrderQty(o);
              const sq = totalScheduledQty(o);
              const dq = totalDeliveredQty(o);
              const delay = orderDelayInfo(o);
              const expanded = !!expandedItems[o.id];
              const firstItem = o.items[0];
              const extra = o.items.length - 1;
              return (
                <tr key={o.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 align-top">
                  <Td className="font-mono text-xs">
                    <button
                      className="text-indigo-600 hover:underline"
                      onClick={() => setViewOrder(o)}
                      data-testid={`so-view-${o.number}`}
                      title="View full sales order details"
                    >{o.number}</button>
                  </Td>
                  <Td>{o.date}</Td>
                  <Td>{db.parties.find(x => x.id === o.customerId)?.name}</Td>
                  <Td>
                    {firstItem ? (
                      <div className="text-xs" data-testid={`so-items-${o.number}`}>
                        {!expanded ? (
                          <>
                            <div className="font-medium text-slate-700 dark:text-slate-200 truncate max-w-[240px]" title={firstItem.name}>
                              {firstItem.name}
                            </div>
                            <div className="text-[11px] text-slate-500">Qty: <b className="text-slate-700 dark:text-slate-200">{firstItem.qty}</b></div>
                            {extra > 0 && (
                              <button
                                type="button"
                                onClick={() => setExpandedItems(prev => ({ ...prev, [o.id]: true }))}
                                className="mt-1 text-[11px] text-indigo-600 hover:underline"
                                data-testid={`so-items-expand-${o.number}`}
                              >+{extra} more</button>
                            )}
                          </>
                        ) : (
                          <>
                            <ol className="space-y-0.5 list-decimal list-inside">
                              {o.items.map((it, i) => (
                                <li key={i} className="text-slate-700 dark:text-slate-200">
                                  <span className="font-medium">{it.name}</span>
                                  <span className="text-slate-500"> — Qty <b>{it.qty}</b></span>
                                </li>
                              ))}
                            </ol>
                            <button
                              type="button"
                              onClick={() => setExpandedItems(prev => ({ ...prev, [o.id]: false }))}
                              className="mt-1 text-[11px] text-indigo-600 hover:underline"
                              data-testid={`so-items-collapse-${o.number}`}
                            >Show less</button>
                          </>
                        )}
                      </div>
                    ) : <span className="text-slate-400">—</span>}
                  </Td>
                  <Td>{o.deliveryDate || "—"}</Td>
                  <Td>
                    <div className="text-xs">
                      <div>{dq}/{sq}<span className="text-slate-400"> of {oq}</span></div>
                      {delay.hasDelay && (
                        <Badge color="red" data-testid={`so-delay-${o.number}`}>
                          {delay.maxDelayDays} {delay.maxDelayDays === 1 ? "Day" : "Days"} Delayed
                        </Badge>
                      )}
                      {!delay.hasDelay && sq > 0 && dq >= sq && <Badge color="green">On Time</Badge>}
                      {sq === 0 && <span className="text-slate-400">No schedule</span>}
                    </div>
                  </Td>
                  <Td className="font-semibold">{fmtINR(totalWithFreight)}</Td>
                  <Td>
                    <Select disabled={!canEdit} value={o.status} onChange={(e: any) => {
                      setDB(d => ({...d, salesOrders: d.salesOrders.map(x => x.id === o.id ? {...x, status: e.target.value} : x)}));
                      log(`SO ${o.number} → ${e.target.value}`, "Sales Order");
                    }} className="text-xs py-1">
                      {SO_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </Select>
                  </Td>
                  <Td><div className="flex gap-1">
                    {canEdit && <Button size="sm" variant="ghost" onClick={() => openEdit(o)}><IconEdit size={14}/></Button>}
                    {canPrint && <Button size="sm" variant="ghost" onClick={() => printSO(o)}><IconPrint size={14}/></Button>}
                    {canDelete && <Button size="sm" variant="ghost" onClick={() => remove(o)}><IconTrash size={14}/></Button>}
                  </div></Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        {list.length === 0 && <Empty title="No sales orders yet"/>}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title={edit ? `Edit ${edit.number}` : "New Sales Order"} size="xl">
        <div className="grid sm:grid-cols-4 gap-3">
          <div><Label>SO No.</Label><Input value={form.number} disabled/></div>
          <div><Label>Date</Label><Input type="date" value={form.date} onChange={(e: any) => setForm({...form, date: e.target.value})}/></div>
          <div className="sm:col-span-2"><Label>Customer</Label>
            <Select value={form.customerId} onChange={(e: any) => setForm({...form, customerId: e.target.value})}>
              <option value="">— Select —</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}{c.city ? ` · ${c.city}` : ""}</option>)}
            </Select>
          </div>
          <div><Label>Delivery Date</Label><Input type="date" value={form.deliveryDate} onChange={(e: any) => setForm({...form, deliveryDate: e.target.value})}/></div>
          <div><Label>Status</Label>
            <Select value={form.status} onChange={(e: any) => setForm({...form, status: e.target.value})}>
              {SO_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </Select>
          </div>
        </div>
        <div className="mt-3 border border-slate-200 dark:border-slate-700 rounded-lg overflow-visible">
          <Table>
            <thead><tr><Th>Item</Th><Th>Qty</Th><Th>Rate</Th><Th>GST%</Th><Th>Amount</Th><Th></Th></tr></thead>
            <tbody>{form.items.map((it, i) => {
              const finishedGoods = db.items.filter(x => x.category === "Finished Goods");
              return (
              <tr key={i}>
                <Td className="min-w-[260px]">
                  <FinishedGoodCombobox
                    items={finishedGoods}
                    value={it.name}
                    onPick={(fg) => pickFinishedGood(i, fg)}
                    onCreateNew={(seed) => setNewItemForRow({ idx: i, seed })}
                    testId={`so-item-combo-${i}`}
                  />
                </Td>
                <Td><Input type="number" value={it.qty} onChange={(e: any) => updateItem(i, "qty", e.target.value)}/></Td>
                <Td><Input type="number" value={it.rate} onChange={(e: any) => updateItem(i, "rate", e.target.value)}/></Td>
                <Td><Select value={it.gst} onChange={(e: any) => updateItem(i, "gst", e.target.value)}>{GST_OPTIONS.map(rate => <option key={rate} value={rate}>{rate}%</option>)}</Select></Td>
                <Td>{fmtINR(it.qty * it.rate)}</Td>
                <Td><Button size="sm" variant="ghost" onClick={() => delItem(i)}><IconTrash size={14}/></Button></Td>
              </tr>
              );
            })}</tbody>
          </Table>
        </div>
        <div className="mt-2"><Button size="sm" variant="outline" onClick={addItem}><IconPlus size={14}/> Add Item</Button></div>

        {form.items.length > 1 ? (
          <div className="space-y-4 mt-5" data-testid="so-schedule-multi">
            <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Item-wise Delivery Planning</div>
            {form.items.filter(it => it.name).map((it, idx) => (
              <ScheduleSection
                key={`${it.name}-${idx}`}
                form={form}
                canManage={canManage}
                itemName={it.name}
                onAdd={() => addSchedule(it.name)}
                onUpdate={updateSchedule}
                onRemove={removeSchedule}
                onSplit={(n) => splitEvenly(n, it.name)}
              />
            ))}
          </div>
        ) : (
          <ScheduleSection
            form={form}
            canManage={canManage}
            onAdd={() => addSchedule()}
            onUpdate={updateSchedule}
            onRemove={removeSchedule}
            onSplit={(n) => splitEvenly(n)}
          />
        )}

        <div className="rounded-lg border p-3 bg-slate-50 dark:bg-slate-800/40 dark:border-slate-700 text-sm mt-3 max-w-sm ml-auto space-y-1">
          <div className="flex justify-between"><span>Sub Total</span><b>{fmtINR(totals.sub)}</b></div>
          <div className="flex justify-between items-center gap-2">
            <span>Freight</span>
            <Input
              type="number"
              value={form.freight ?? 0}
              onChange={(e: any) => setForm({ ...form, freight: Number(e.target.value) || 0 })}
              className="w-32 text-right py-1 h-8"
              data-testid="so-freight-input"
            />
          </div>
          <div className="flex justify-between"><span>GST</span><b>{fmtINR(totals.gst)}</b></div>
          <div className="flex justify-between text-base border-t pt-1 mt-1"><span>Total</span><b className="text-emerald-600">{fmtINR(grandTotal)}</b></div>
        </div>
        <div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save} data-testid="so-save-btn">{edit ? "Update" : "Create"}</Button></div>
      </Modal>

      <NewFinishedGoodModal
        open={!!newItemForRow}
        seedName={newItemForRow?.seed || ""}
        onClose={() => setNewItemForRow(null)}
        onCreated={(item) => {
          if (newItemForRow) pickFinishedGood(newItemForRow.idx, item as any);
          setNewItemForRow(null);
        }}
        testIdPrefix="so-new-fg"
      />

      <Modal open={!!viewOrder} onClose={() => setViewOrder(null)} title={viewOrder ? `Sales Order · ${viewOrder.number}` : "Sales Order"} size="xl">
        {viewOrder && (() => {
          const o = viewOrder;
          const cust = db.parties.find(x => x.id === o.customerId);
          const owner = db.users.find(u => u.id === o.ownerId);
          const proforma = o.proformaId ? db.proformas.find(p => p.id === o.proformaId) : null;
          const t = calcDocTotalsWithFreight(o.items, Number(o.freight) || 0);
          const oq = totalOrderQty(o);
          const sq = totalScheduledQty(o);
          const dq = totalDeliveredQty(o);
          const delay = orderDelayInfo(o);
          const linkedJobCards = db.jobCards.filter(j => j.salesOrderId === o.id);
          const linkedChallans = db.challans.filter(c => c.salesOrderId === o.id);
          const schedules = (o.schedules || []).slice().sort((a, b) => (a.date || "").localeCompare(b.date || ""));
          return (
            <div className="space-y-4 text-sm">
              <div className="grid sm:grid-cols-3 gap-3">
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-slate-50 dark:bg-slate-800/40">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">Order Info</div>
                  <div><span className="text-slate-500">No.:</span> <b className="font-mono">{o.number}</b></div>
                  <div><span className="text-slate-500">Date:</span> <b>{o.date}</b></div>
                  <div><span className="text-slate-500">Status:</span> <Badge color={o.status === "Delivered" ? "green" : o.status === "Dispatched" ? "blue" : o.status === "In Production" ? "amber" : "slate"}>{o.status}</Badge></div>
                  <div><span className="text-slate-500">Owner:</span> {owner?.name || "—"}</div>
                  {proforma && <div><span className="text-slate-500">Proforma:</span> <b className="font-mono">{proforma.number}</b></div>}
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-slate-50 dark:bg-slate-800/40 sm:col-span-2">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">Customer</div>
                  <div className="font-semibold text-slate-800 dark:text-slate-100">{cust?.name || "—"}</div>
                  {cust?.address && <div className="text-xs text-slate-500">{cust.address}{cust?.city ? `, ${cust.city}` : ""}</div>}
                  <div className="text-xs text-slate-500 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                    {cust?.gst && <span>GST: <b>{cust.gst}</b></span>}
                    {cust?.mobile && <span>Mobile: <b>{cust.mobile}</b></span>}
                    {cust?.email && <span>Email: <b>{cust.email}</b></span>}
                    {cust?.contactPerson && <span>Contact: <b>{cust.contactPerson}</b></span>}
                  </div>
                </div>
              </div>

              <div className="grid sm:grid-cols-4 gap-3">
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-white dark:bg-slate-900">
                  <div className="text-[11px] text-slate-500">Delivery Date</div>
                  <div className="text-base font-semibold">{o.deliveryDate || "—"}</div>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-white dark:bg-slate-900">
                  <div className="text-[11px] text-slate-500">Ordered Qty</div>
                  <div className="text-base font-semibold">{oq}</div>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-white dark:bg-slate-900">
                  <div className="text-[11px] text-slate-500">Scheduled / Delivered</div>
                  <div className="text-base font-semibold">{sq} / {dq}</div>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-white dark:bg-slate-900">
                  <div className="text-[11px] text-slate-500">Delay</div>
                  <div className="text-base font-semibold">
                    {delay.hasDelay ? <span className="text-rose-600">{delay.maxDelayDays} {delay.maxDelayDays === 1 ? "Day" : "Days"}</span> : <span className="text-emerald-600">On Time</span>}
                  </div>
                </div>
              </div>

              <div>
                <div className="text-sm font-semibold mb-2">Items</div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                  <Table>
                    <thead><tr><Th>#</Th><Th>Item</Th><Th className="text-right">Qty</Th><Th className="text-right">Rate</Th><Th className="text-right">GST %</Th><Th className="text-right">Amount</Th></tr></thead>
                    <tbody>
                      {o.items.map((it, i) => (
                        <tr key={i}>
                          <Td>{i + 1}</Td>
                          <Td className="font-medium">{it.name}</Td>
                          <Td className="text-right">{it.qty}</Td>
                          <Td className="text-right">{fmtINR(it.rate)}</Td>
                          <Td className="text-right">{it.gst}%</Td>
                          <Td className="text-right font-medium">{fmtINR(it.qty * it.rate)}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-slate-50 dark:bg-slate-800/40">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-2">Linked Documents</div>
                  <div className="space-y-1 text-xs">
                    <div><span className="text-slate-500">Proforma:</span> {proforma ? <b className="font-mono">{proforma.number}</b> : <span className="text-slate-400">—</span>}</div>
                    <div><span className="text-slate-500">Job Cards:</span> {linkedJobCards.length ? linkedJobCards.map(j => <b key={j.id} className="font-mono mr-2">{j.number}</b>) : <span className="text-slate-400">—</span>}</div>
                    <div><span className="text-slate-500">Delivery Challans:</span> {linkedChallans.length ? linkedChallans.map(c => <b key={c.id} className="font-mono mr-2">{c.number}</b>) : <span className="text-slate-400">—</span>}</div>
                  </div>
                </div>
                <div className="rounded-lg border p-3 bg-slate-50 dark:bg-slate-800/40 dark:border-slate-700 space-y-1">
                  <div className="flex justify-between"><span>Sub Total</span><b>{fmtINR(t.sub)}</b></div>
                  <div className="flex justify-between"><span>Freight</span><b>{fmtINR(t.freight)}</b></div>
                  <div className="flex justify-between"><span>GST</span><b>{fmtINR(t.gst)}</b></div>
                  <div className="flex justify-between text-base border-t pt-1 mt-1"><span>Total</span><b className="text-emerald-600">{fmtINR(t.total)}</b></div>
                </div>
              </div>

              {schedules.length > 0 && (
                <div>
                  <div className="text-sm font-semibold mb-2">Delivery Schedule</div>
                  <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                    <Table>
                      <thead><tr><Th>Date</Th>{o.items.length > 1 && <Th>Item</Th>}<Th className="text-right">Scheduled</Th><Th className="text-right">Delivered</Th><Th className="text-right">Pending</Th><Th>Status</Th></tr></thead>
                      <tbody>
                        {schedules.map(s => {
                          const st = scheduleStatus(s);
                          return (
                            <tr key={s.id}>
                              <Td>{s.date || "—"}</Td>
                              {o.items.length > 1 && <Td>{s.itemName || "—"}</Td>}
                              <Td className="text-right">{s.qty}</Td>
                              <Td className="text-right">{s.deliveredQty || 0}</Td>
                              <Td className="text-right">{st.pending}</Td>
                              <Td>
                                {st.isCompleted ? <Badge color="green">Completed</Badge>
                                  : st.isOverdue ? <Badge color="red">{st.delayDays} Days Delayed</Badge>
                                  : <Badge color="slate">On Track</Badge>}
                              </Td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </Table>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                <Button variant="outline" onClick={() => setViewOrder(null)}>Close</Button>
                {canPrint && <Button variant="outline" onClick={() => printSO(o)} data-testid="so-view-print"><IconPrint size={14}/> Print</Button>}
                {canEdit && (
                  <Button onClick={() => { setViewOrder(null); openEdit(o); }} data-testid="so-view-edit"><IconEdit size={14}/> Edit</Button>
                )}
              </div>
            </div>
          );
        })()}
      </Modal>

      <Modal open={!!customerDrill} onClose={() => setCustomerDrill(null)} title="Customer Sales Details" size="xl">
        {customerDrill && (() => {
          const agg = topCustomersFull.find(x => x.customerId === customerDrill);
          const cust = db.parties.find(p => p.id === customerDrill);
          const custSOs = list.filter(o => o.customerId === customerDrill)
            .slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
          const custSOIds = new Set(custSOs.map(o => o.id));
          const custDCs = relevantChallans.filter(c => c.customerId === customerDrill || custSOIds.has(c.salesOrderId))
            .slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
          // Totals from Sales Orders (as requested)
          const totalQty = custSOs.reduce((s, o) => s + o.items.reduce((a, i) => a + (Number(i.qty) || 0), 0), 0);
          const totalValue = custSOs.reduce((s, o) => s + o.items.reduce((a, i) => a + (Number(i.qty) || 0) * (Number(i.rate) || 0) * (1 + (Number(i.gst) || 0) / 100), 0) + (Number(o.freight) || 0), 0);
          // Dispatched (DC-based) for reference
          const dcQty = custDCs.reduce((s, c) => s + (c.items || []).reduce((a, i) => a + (Number(i.qty) || 0), 0), 0);
          const dcValue = custDCs.reduce((s, c) => {
            const items = (c.items || []);
            return s + items.reduce((a, i) => a + (Number(i.qty) || 0) * (Number(i.rate) || 0) * (1 + (Number(i.gst) || 0) / 100), 0) + (Number(c.freight) || 0);
          }, 0);
          return (
            <div className="space-y-4 text-sm">
              <div className="grid sm:grid-cols-3 gap-3">
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-slate-50 dark:bg-slate-800/40 sm:col-span-3">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">Customer</div>
                  <div className="font-semibold text-slate-800 dark:text-slate-100 text-base">{agg?.name || cust?.name || "—"}</div>
                  {cust?.address && <div className="text-xs text-slate-500">{cust.address}{cust?.city ? `, ${cust.city}` : ""}</div>}
                  <div className="text-xs text-slate-500 mt-1 flex flex-wrap gap-x-3">
                    {cust?.gst && <span>GST: <b>{cust.gst}</b></span>}
                    {cust?.mobile && <span>Mobile: <b>{cust.mobile}</b></span>}
                    {cust?.contactPerson && <span>Contact: <b>{cust.contactPerson}</b></span>}
                  </div>
                </div>
                <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 p-3 bg-emerald-50 dark:bg-emerald-900/20">
                  <div className="text-[11px] uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Total Sales Quantity</div>
                  <div className="text-2xl font-bold text-emerald-800 dark:text-emerald-200" data-testid="cust-drill-qty">{totalQty} <span className="text-xs font-normal">Nos</span></div>
                  <div className="text-[10px] text-slate-500 mt-0.5">From Sales Orders</div>
                </div>
                <div className="rounded-lg border border-indigo-200 dark:border-indigo-800 p-3 bg-indigo-50 dark:bg-indigo-900/20">
                  <div className="text-[11px] uppercase tracking-wide text-indigo-700 dark:text-indigo-300">Total Sales Amount</div>
                  <div className="text-2xl font-bold text-indigo-800 dark:text-indigo-200" data-testid="cust-drill-value">{fmtINR(totalValue)}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">From Sales Orders (incl GST + Freight)</div>
                </div>
                <div className="rounded-lg border border-teal-200 dark:border-teal-800 p-3 bg-teal-50 dark:bg-teal-900/20">
                  <div className="text-[11px] uppercase tracking-wide text-teal-700 dark:text-teal-300">Dispatched (DC)</div>
                  <div className="text-lg font-bold text-teal-700 dark:text-teal-300">{dcQty} <span className="text-[10px] font-normal">Nos</span></div>
                  <div className="text-xs font-semibold text-teal-700 dark:text-teal-300">{fmtINR(dcValue)}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{custDCs.length} DC{custDCs.length === 1 ? "" : "s"}</div>
                </div>
              </div>

              <div>
                <div className="text-sm font-semibold mb-2">Sales Orders ({custSOs.length})</div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden max-h-72 overflow-y-auto">
                  <Table>
                    <thead><tr><Th>SO #</Th><Th>Date</Th><Th className="text-right">Ordered Qty</Th><Th className="text-right">Order Value</Th><Th>Status</Th></tr></thead>
                    <tbody>
                      {custSOs.length === 0 && <tr><Td colSpan={5} className="text-center text-slate-500 py-6">No SOs for this customer</Td></tr>}
                      {custSOs.map(o => {
                        const oQty = o.items.reduce((s, i) => s + (Number(i.qty) || 0), 0);
                        const oVal = o.items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.rate) || 0) * (1 + (Number(i.gst) || 0) / 100), 0) + (Number(o.freight) || 0);
                        return (
                          <tr key={o.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                            <Td className="font-mono text-xs">
                              <button className="text-indigo-600 hover:underline" onClick={() => { setCustomerDrill(null); setViewOrder(o); }}>{o.number}</button>
                            </Td>
                            <Td>{o.date}</Td>
                            <Td className="text-right">{oQty}</Td>
                            <Td className="text-right font-medium">{fmtINR(oVal)}</Td>
                            <Td><Badge color={o.status === "Delivered" ? "green" : o.status === "In Production" ? "amber" : "slate"}>{o.status}</Badge></Td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </Table>
                </div>
              </div>

              <div>
                <div className="text-sm font-semibold mb-2">Delivery Challans ({custDCs.length})</div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden max-h-72 overflow-y-auto">
                  <Table>
                    <thead><tr><Th>DC #</Th><Th>Date</Th><Th>SO</Th><Th className="text-right">Qty</Th><Th className="text-right">Value</Th></tr></thead>
                    <tbody>
                      {custDCs.length === 0 && <tr><Td colSpan={5} className="text-center text-slate-500 py-6">No DCs for this customer</Td></tr>}
                      {custDCs.map(c => {
                        const qty = (c.items || []).reduce((a, i) => a + (Number(i.qty) || 0), 0);
                        const val = (c.items || []).reduce((a, i) => a + (Number(i.qty) || 0) * (Number(i.rate) || 0) * (1 + (Number(i.gst) || 0) / 100), 0) + (Number(c.freight) || 0);
                        const so = db.salesOrders.find(s => s.id === c.salesOrderId);
                        return (
                          <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                            <Td className="font-mono text-xs">{c.number}</Td>
                            <Td>{c.date}</Td>
                            <Td className="font-mono text-xs">{so?.number || "—"}</Td>
                            <Td className="text-right">{qty}</Td>
                            <Td className="text-right font-medium">{fmtINR(val)}</Td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </Table>
                </div>
              </div>

              <div className="flex justify-end pt-2 border-t border-slate-200 dark:border-slate-700">
                <Button variant="outline" onClick={() => setCustomerDrill(null)}>Close</Button>
              </div>
            </div>
          );
        })()}
      </Modal>

      <Modal open={!!monthDrill} onClose={() => setMonthDrill(null)} title={monthDrill ? `Sales for ${monthBuckets.find(m => m.key === monthDrill)?.label} ${monthDrill.slice(0, 4)}` : "Monthly Sales"} size="xl">
        {monthDrill && (() => {
          const monthDCs = relevantChallans.filter(c => c.date && c.date.slice(0, 7) === monthDrill)
            .slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
          const monthSOIds = new Set(monthDCs.map(c => c.salesOrderId).filter(Boolean));
          const monthSOs = list.filter(o => monthSOIds.has(o.id));
          const totalQty = monthDCs.reduce((s, c) => s + (c.items || []).reduce((a, i) => a + (Number(i.qty) || 0), 0), 0);
          const totalValue = monthDCs.reduce((s, c) => {
            const items = (c.items || []);
            return s + items.reduce((a, i) => a + (Number(i.qty) || 0) * (Number(i.rate) || 0) * (1 + (Number(i.gst) || 0) / 100), 0) + (Number(c.freight) || 0);
          }, 0);
          return (
            <div className="space-y-4 text-sm">
              <div className="grid sm:grid-cols-3 gap-3">
                <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 p-3 bg-emerald-50 dark:bg-emerald-900/20">
                  <div className="text-[11px] uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Total Sales Quantity</div>
                  <div className="text-2xl font-bold text-emerald-800 dark:text-emerald-200" data-testid="month-drill-qty">{totalQty} <span className="text-xs font-normal">Nos</span></div>
                </div>
                <div className="rounded-lg border border-indigo-200 dark:border-indigo-800 p-3 bg-indigo-50 dark:bg-indigo-900/20">
                  <div className="text-[11px] uppercase tracking-wide text-indigo-700 dark:text-indigo-300">Total Sales Amount</div>
                  <div className="text-2xl font-bold text-indigo-800 dark:text-indigo-200" data-testid="month-drill-value">{fmtINR(totalValue)}</div>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-white dark:bg-slate-900">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">Delivery Challans</div>
                  <div className="text-2xl font-bold">{monthDCs.length}</div>
                </div>
              </div>

              <div>
                <div className="text-sm font-semibold mb-2">Delivery Challans ({monthDCs.length})</div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden max-h-72 overflow-y-auto">
                  <Table>
                    <thead><tr><Th>DC #</Th><Th>Date</Th><Th>Customer</Th><Th>SO</Th><Th className="text-right">Qty</Th><Th className="text-right">Value</Th></tr></thead>
                    <tbody>
                      {monthDCs.length === 0 && <tr><Td colSpan={6} className="text-center text-slate-500 py-6">No DCs for this month</Td></tr>}
                      {monthDCs.map(c => {
                        const qty = (c.items || []).reduce((a, i) => a + (Number(i.qty) || 0), 0);
                        const val = (c.items || []).reduce((a, i) => a + (Number(i.qty) || 0) * (Number(i.rate) || 0) * (1 + (Number(i.gst) || 0) / 100), 0) + (Number(c.freight) || 0);
                        const so = db.salesOrders.find(s => s.id === c.salesOrderId);
                        const cust = db.parties.find(p => p.id === c.customerId);
                        return (
                          <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                            <Td className="font-mono text-xs">{c.number}</Td>
                            <Td>{c.date}</Td>
                            <Td className="truncate max-w-[200px]">{cust?.name || "—"}</Td>
                            <Td className="font-mono text-xs">{so?.number || "—"}</Td>
                            <Td className="text-right">{qty}</Td>
                            <Td className="text-right font-medium">{fmtINR(val)}</Td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </Table>
                </div>
              </div>

              <div>
                <div className="text-sm font-semibold mb-2">Sales Orders in this month's dispatches ({monthSOs.length})</div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden max-h-72 overflow-y-auto">
                  <Table>
                    <thead><tr><Th>SO #</Th><Th>Date</Th><Th>Customer</Th><Th className="text-right">Ordered Qty</Th><Th className="text-right">Order Value</Th></tr></thead>
                    <tbody>
                      {monthSOs.length === 0 && <tr><Td colSpan={5} className="text-center text-slate-500 py-6">No SOs to show</Td></tr>}
                      {monthSOs.map(o => {
                        const oQty = o.items.reduce((s, i) => s + (Number(i.qty) || 0), 0);
                        const oVal = o.items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.rate) || 0) * (1 + (Number(i.gst) || 0) / 100), 0) + (Number(o.freight) || 0);
                        return (
                          <tr key={o.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                            <Td className="font-mono text-xs">
                              <button className="text-indigo-600 hover:underline" onClick={() => { setMonthDrill(null); setViewOrder(o); }}>{o.number}</button>
                            </Td>
                            <Td>{o.date}</Td>
                            <Td className="truncate max-w-[200px]">{db.parties.find(p => p.id === o.customerId)?.name || "—"}</Td>
                            <Td className="text-right">{oQty}</Td>
                            <Td className="text-right font-medium">{fmtINR(oVal)}</Td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </Table>
                </div>
              </div>

              <div className="flex justify-end pt-2 border-t border-slate-200 dark:border-slate-700">
                <Button variant="outline" onClick={() => setMonthDrill(null)}>Close</Button>
              </div>
            </div>
          );
        })()}
      </Modal>

      <Badge color="slate">Use the Sales Order to create a Job Card for production.</Badge>
    </div>
  );
}

function ScheduleSection({
  form, canManage, onAdd, onUpdate, onRemove, onSplit, itemName,
}: {
  form: SalesOrder;
  canManage: boolean;
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<DeliverySchedule>) => void;
  onRemove: (id: string) => void;
  onSplit: (n: number) => void;
  itemName?: string;
}) {
  const orderQty = itemName ? orderQtyForItem(form, itemName) : totalOrderQty(form);
  const scheduled = itemName ? scheduledQtyForItem(form, itemName) : totalScheduledQty(form);
  const delivered = itemName ? deliveredQtyForItem(form, itemName) : totalDeliveredQty(form);
  const remaining = Math.max(0, orderQty - scheduled);
  const balanced = scheduled === orderQty;
  const overScheduled = scheduled > orderQty;
  const slots = itemName ? schedulesForItem(form, itemName) : (form.schedules || []);
  const testIdSuffix = itemName ? `-${itemName.replace(/\s+/g, "-").toLowerCase()}` : "";

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden" data-testid={`so-schedule-section${testIdSuffix}`}>
      <div className="px-4 py-3 flex items-center justify-between bg-slate-50 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-700">
        <div>
          <div className="font-semibold text-slate-800 dark:text-slate-100">
            {itemName ? <>Delivery Schedule — <span className="text-indigo-600 dark:text-indigo-400">{itemName}</span></> : "Delivery Schedule"}
          </div>
          <div className="text-xs text-slate-500">
            {itemName
              ? `Plan deliveries for this line item. Ordered ${orderQty}.`
              : "Split the order quantity into planned deliveries. Total must equal order quantity."}
            {!canManage && <span className="ml-1 text-amber-600">(Read-only — only the order creator or Admin can edit.)</span>}
          </div>
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-1 text-xs">
              <span className="text-slate-500">Split into</span>
              {[2, 3, 4].map(n => (
                <Button key={n} size="sm" variant="outline" onClick={() => onSplit(n)} data-testid={`so-split-${n}${testIdSuffix}`}>{n}</Button>
              ))}
            </div>
            <Button size="sm" variant="outline" onClick={onAdd} data-testid={`so-add-schedule${testIdSuffix}`}><IconPlus size={14}/> Add Slot</Button>
          </div>
        )}
      </div>

      {slots.length === 0 ? (
        <div className="p-6 text-center text-sm text-slate-500">
          No delivery slots yet.{canManage && ` Click "Add Slot" or split into parts.`}
        </div>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Delivery Date</Th><Th>Scheduled Qty</Th><Th>Delivered Qty</Th><Th>Pending / Balance</Th><Th>Status</Th><Th>Note</Th><Th></Th>
            </tr>
          </thead>
          <tbody>
            {slots.map(s => {
              const st = scheduleStatus(s);
              return (
                <tr key={s.id}>
                  <Td>
                    <Input
                      type="date"
                      value={s.date}
                      disabled={!canManage}
                      onChange={(e: any) => onUpdate(s.id, { date: e.target.value })}
                      data-testid={`so-schedule-date-${s.id}`}
                    />
                    {s.date && (
                      <div className="text-[10px] mt-1 text-slate-500">
                        {new Date(s.date).toLocaleString("en-IN", { month: "long", year: "numeric" })}
                      </div>
                    )}
                  </Td>
                  <Td>
                    <Input
                      type="number"
                      min={0}
                      max={orderQty}
                      value={s.qty}
                      disabled={!canManage}
                      onChange={(e: any) => onUpdate(s.id, { qty: Math.max(0, Number(e.target.value) || 0) })}
                      data-testid={`so-schedule-qty-${s.id}`}
                    />
                  </Td>
                  <Td>
                    <Input
                      type="number"
                      min={0}
                      max={s.qty}
                      value={s.deliveredQty || 0}
                      disabled={!canManage}
                      onChange={(e: any) => onUpdate(s.id, { deliveredQty: Math.max(0, Math.min(s.qty, Number(e.target.value) || 0)) })}
                      data-testid={`so-schedule-delivered-${s.id}`}
                    />
                  </Td>
                  <Td className="font-semibold">{st.pending}</Td>
                  <Td>
                    {st.isCompleted
                      ? <Badge color="green">Completed</Badge>
                      : st.isOverdue
                        ? <Badge color="red">{st.delayDays} {st.delayDays === 1 ? "Day" : "Days"} Delayed</Badge>
                        : <Badge color="blue">On Track</Badge>}
                  </Td>
                  <Td>
                    <Input
                      value={s.note || ""}
                      disabled={!canManage}
                      onChange={(e: any) => onUpdate(s.id, { note: e.target.value })}
                      placeholder="Optional"
                    />
                  </Td>
                  <Td>{canManage && <Button size="sm" variant="ghost" onClick={() => onRemove(s.id)}><IconTrash size={14}/></Button>}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}

      <div className="px-4 py-2 flex flex-wrap gap-3 justify-between items-center bg-slate-50/60 dark:bg-slate-800/30 text-xs">
        <div className="flex flex-wrap gap-3">
          <span>{itemName ? "Item Qty" : "Total Order Qty"}: <b>{orderQty}</b></span>
          <span>Scheduled: <b>{scheduled}</b></span>
          <span>Delivered: <b>{delivered}</b></span>
          <span>Unscheduled Balance: <b className={remaining > 0 ? "text-amber-600" : "text-emerald-600"}>{remaining}</b></span>
        </div>
        <div>
          {overScheduled && <Badge color="red">Over-scheduled by {scheduled - orderQty}</Badge>}
          {!overScheduled && balanced && scheduled > 0 && <Badge color="green"><IconCheck size={12}/> Balanced</Badge>}
          {!overScheduled && !balanced && scheduled > 0 && <Badge color="amber">Pending {remaining}</Badge>}
        </div>
      </div>
    </div>
  );
}
