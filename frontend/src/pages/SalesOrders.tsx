import { useState, useMemo } from "react";
import { useStore, uid } from "../lib/store";
import { Card, Button, Input, Select, Label, Modal, Table, Th, Td, Badge, Empty } from "../components/ui";
import { FinishedGoodCombobox } from "../components/FinishedGoodCombobox";
import type { SalesOrder, DeliverySchedule } from "../lib/types";
import { IconPlus, IconEdit, IconTrash, IconPrint, IconCheck } from "../components/icons";
import { calcDocTotals, fmtINR, nextNumber, printArea, professionalDocument, todayISO } from "../lib/utils";
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

  const list = useMemo(() => {
    const arr = isAdmin ? db.salesOrders : db.salesOrders.filter(o => o.ownerId === currentUser?.id);
    return arr.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [db.salesOrders, isAdmin, currentUser]);

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
  const totals = calcDocTotals(form.items);
  const freight = Number(form.freight) || 0;
  const grandTotal = totals.total + freight;

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
    const t = calcDocTotals(o.items);
    const fr = Number(o.freight) || 0;
    const grand = t.total + fr;
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

      <Card>
        <Table>
          <thead><tr><Th>#</Th><Th>Date</Th><Th>Customer</Th><Th>Product(s) &amp; Qty</Th><Th>Delivery</Th><Th>Schedule</Th><Th>Total</Th><Th>Status</Th><Th></Th></tr></thead>
          <tbody>
            {list.map(o => {
              const t = calcDocTotals(o.items);
              const totalWithFreight = t.total + (Number(o.freight) || 0);
              const oq = totalOrderQty(o);
              const sq = totalScheduledQty(o);
              const dq = totalDeliveredQty(o);
              const delay = orderDelayInfo(o);
              const expanded = !!expandedItems[o.id];
              const firstItem = o.items[0];
              const extra = o.items.length - 1;
              return (
                <tr key={o.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 align-top">
                  <Td className="font-mono text-xs">{o.number}</Td>
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
