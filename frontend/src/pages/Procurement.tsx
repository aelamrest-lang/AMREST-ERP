import { useMemo, useRef, useState } from "react";
import { useStore, uid } from "../lib/store";
import { Card, Button, Input, Select, Label, Modal, Table, Th, Td, Badge, Empty, Textarea } from "../components/ui";
import type { PurchaseOrder, GRN, GrnAuditEntry, Party, POApprovalEvent } from "../lib/types";
import { IconPlus, IconEdit, IconTrash, IconPrint, IconSearch, IconCheck, IconHistory } from "../components/icons";
import { fmtINR, fmt2, nextNumber, printArea, professionalDocument, todayISO } from "../lib/utils";
import { userCan } from "../lib/permissions";

const DEFAULT_PO_TERMS = `1. Material should be as per specification.
2. Delivery within committed date.
3. Test certificate mandatory.
4. GST and transport terms as mutually agreed.
5. Material will be subject to quality inspection at our works.`;

function VendorCombobox({
  vendors, value, onChange, placeholder = "Search vendor by name, GST, contact...",
}: {
  vendors: Party[]; value: string; onChange: (id: string) => void; placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const selected = vendors.find(v => v.id === value) || null;
  const displayText = open ? query : (selected?.name || "");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return vendors;
    return vendors.filter(v =>
      v.name.toLowerCase().includes(q) ||
      (v.gst || "").toLowerCase().includes(q) ||
      (v.city || "").toLowerCase().includes(q) ||
      (v.address || "").toLowerCase().includes(q) ||
      (v.mobile || "").toLowerCase().includes(q) ||
      (v.email || "").toLowerCase().includes(q) ||
      (v.contactPerson || "").toLowerCase().includes(q),
    );
  }, [vendors, query]);

  const pick = (v: Party) => {
    onChange(v.id);
    setOpen(false);
    setQuery("");
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHighlight(h => Math.min(filtered.length - 1, h + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight(h => Math.max(0, h - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); if (filtered[highlight]) pick(filtered[highlight]); }
    else if (e.key === "Escape") { setOpen(false); setQuery(""); }
  };

  const onBlur = (e: React.FocusEvent) => {
    // Only close if focus leaves the wrapper entirely
    setTimeout(() => {
      if (wrapRef.current && !wrapRef.current.contains(document.activeElement)) {
        setOpen(false);
        setQuery("");
      }
    }, 0);
  };

  return (
    <div className="relative" ref={wrapRef} onBlur={onBlur}>
      <div className="relative">
        <IconSearch size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"/>
        <Input
          className="pl-9"
          value={displayText}
          placeholder={placeholder}
          onFocus={() => { setOpen(true); setHighlight(0); }}
          onChange={(e: any) => { setQuery(e.target.value); setOpen(true); setHighlight(0); }}
          onKeyDown={handleKey}
          data-testid="po-vendor-combobox"
        />
        {selected && !open && (
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-rose-500"
            onMouseDown={(e) => { e.preventDefault(); onChange(""); }}
            title="Clear vendor"
          >✕</button>
        )}
      </div>
      {open && (
        <div className="absolute z-30 mt-1 w-full max-h-72 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg">
          {filtered.length === 0 && <div className="p-3 text-sm text-slate-500">No vendors match “{query}”.</div>}
          {filtered.map((v, idx) => (
            <button
              type="button"
              key={v.id}
              onMouseDown={(e) => { e.preventDefault(); pick(v); }}
              onMouseEnter={() => setHighlight(idx)}
              data-testid={`po-vendor-option-${v.id}`}
              className={"w-full text-left px-3 py-2 flex items-start justify-between gap-3 " + (idx === highlight ? "bg-indigo-50 dark:bg-indigo-900/30" : "hover:bg-slate-50 dark:hover:bg-slate-800/50")}
            >
              <div className="min-w-0">
                <div className="font-medium text-slate-800 dark:text-slate-100 truncate">{v.name}</div>
                <div className="text-xs text-slate-500 truncate">
                  {[v.city, v.gst, v.mobile].filter(Boolean).join(" · ") || v.email || v.address || ""}
                </div>
              </div>
              {v.id === value && <span className="text-xs text-indigo-600 font-semibold">Selected</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function getDefaultPurchaseTerms(settings: any) {
  const format = (settings.documentFormats || []).find((f: any) => f.active && f.documentType === "Purchase Order");
  const terms = (format?.terms || []).filter((t: any) => t.active).sort((a: any, b: any) => a.order - b.order);
  return terms.length ? terms.map((t: any, i: number) => `${i + 1}. ${t.text}`).join("\n") : DEFAULT_PO_TERMS;
}

function addDaysISO(iso: string, days: number): string {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
const DEFAULT_LEAD_TIME_DAYS = 10;

function poReceivedTotals(po: PurchaseOrder, grns: GRN[]): { received: number; ordered: number; pending: number; fullyReceived: boolean } {
  const ordered = po.items.reduce((s, i) => s + (Number(i.qty) || 0), 0);
  const already: Record<string, number> = {};
  grns.filter(g => g.poId === po.id).forEach(g => g.receivedItems.forEach(r => { already[r.itemId] = (already[r.itemId] || 0) + (r.qty || 0); }));
  const received = po.items.reduce((s, i) => s + Math.min(i.qty, already[i.itemId] || 0), 0);
  const pending = Math.max(0, ordered - received);
  const fullyReceived = po.items.length > 0 && po.items.every(i => (already[i.itemId] || 0) >= i.qty);
  return { received, ordered, pending, fullyReceived };
}

export function poDelayDays(po: PurchaseOrder, grns: GRN[], now: Date = new Date()): number {
  if (po.status === "Cancelled") return 0;
  const { fullyReceived } = poReceivedTotals(po, grns);
  if (fullyReceived) return 0;
  if (!po.expectedDeliveryDate) return 0;
  const due = new Date(po.expectedDeliveryDate + "T23:59:59");
  if (isNaN(due.getTime()) || now <= due) return 0;
  return Math.max(1, Math.floor((now.getTime() - due.getTime()) / (24 * 60 * 60 * 1000)));
}

export function isPOOverdue(po: PurchaseOrder, grns: GRN[], now: Date = new Date()): boolean {
  return poDelayDays(po, grns, now) > 0;
}

export function overdueSummary(po: PurchaseOrder, grns: GRN[], now: Date = new Date()) {
  const totals = poReceivedTotals(po, grns);
  return { ...totals, delayDays: poDelayDays(po, grns, now) };
}

export function PurchaseOrders() {
  const { db, setDB, log, currentUser } = useStore();
  const canCreate = userCan(currentUser, "purchase", "create");
  const canEdit = userCan(currentUser, "purchase", "edit");
  const canDelete = userCan(currentUser, "purchase", "delete");
  const canApprove = userCan(currentUser, "purchase", "approve");
  const canPrint = userCan(currentUser, "purchase", "print");
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<PurchaseOrder | null>(null);
  const [itemSearch, setItemSearch] = useState<Record<number, string>>({});
  const [preview, setPreview] = useState<PurchaseOrder | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [vendorQuery, setVendorQuery] = useState("");

  const vendors = db.parties.filter(p => p.type === "vendor" || p.type === "supplier");

  const filteredPOs = useMemo(() => {
    const q = vendorQuery.trim().toLowerCase();
    if (!q) return db.purchaseOrders;
    return db.purchaseOrders.filter(p => {
      const vendorName = db.parties.find(v => v.id === p.vendorId)?.name || "";
      return vendorName.toLowerCase().includes(q) || p.number.toLowerCase().includes(q);
    });
  }, [db.purchaseOrders, db.parties, vendorQuery]);

  const blank = (): PurchaseOrder => {
    const d = todayISO();
    const now = new Date().toISOString();
    return {
      id: "", number: nextNumber("PO", db.purchaseOrders), date: d, vendorId: vendors[0]?.id || "",
      items: [], terms: getDefaultPurchaseTerms(db.settings),
      expectedDeliveryDate: addDaysISO(d, DEFAULT_LEAD_TIME_DAYS),
      status: "Draft",
      approvalStatus: "Pending",
      approvalHistory: [{ userId: currentUser?.id || "", userName: currentUser?.name || "", action: "Submitted", timestamp: now }],
      createdByName: currentUser?.name,
      createdById: currentUser?.id,
      createdAt: now,
    };
  };
  const [form, setForm] = useState<PurchaseOrder>(blank());

  const isCreator = (p: PurchaseOrder) => !!currentUser && p.createdById === currentUser.id;
  const isAdmin = currentUser?.role === "admin";
  const canEditPO = (p: PurchaseOrder) => {
    if (!canEdit) return false;
    if (isAdmin) return true;
    // Locked after approval for non-admins
    if (p.approvalStatus === "Approved") return false;
    // If rejected, only creator can edit and resubmit
    if (p.approvalStatus === "Rejected") return isCreator(p);
    return true;
  };

  const openNew = () => { setEdit(null); setForm(blank()); setItemSearch({}); setOpen(true); };
  const openEdit = (p: PurchaseOrder) => {
    if (!canEditPO(p)) return alert("This PO is locked. Only Admin can edit approved orders.");
    // If it was rejected and the creator is opening it, treat this as a resubmission when saved
    setEdit(p);
    setForm({...p, terms: p.terms || getDefaultPurchaseTerms(db.settings), items: p.items.map(i => ({...i}))});
    setItemSearch({});
    setOpen(true);
  };
  const save = () => {
    const now = new Date().toISOString();
    let next: PurchaseOrder = { ...form };
    if (edit && edit.approvalStatus === "Rejected") {
      // Resubmit for approval
      next = {
        ...next,
        approvalStatus: "Pending",
        rejectionReason: "",
        approvedById: undefined, approvedByName: undefined, approvedAt: undefined,
        approvalHistory: [
          ...(next.approvalHistory || []),
          { userId: currentUser?.id || "", userName: currentUser?.name || "", action: "Resubmitted", timestamp: now },
        ],
      };
      log(`Resubmitted PO ${next.number} for approval`, "Purchase");
    } else if (!edit) {
      next.approvalStatus = "Pending";
      next.createdById = currentUser?.id;
      next.createdByName = currentUser?.name;
      next.approvalHistory = [{ userId: currentUser?.id || "", userName: currentUser?.name || "", action: "Submitted", timestamp: now }];
    }
    if (edit) setDB(d => ({...d, purchaseOrders: d.purchaseOrders.map(x => x.id === edit.id ? next : x)}));
    else setDB(d => ({...d, purchaseOrders: [{...next, id: uid()}, ...d.purchaseOrders]}));
    log(`${edit ? "Updated" : "Created"} PO ${form.number}`, "Purchase");
    setOpen(false);
  };
  const remove = (p: PurchaseOrder) => {
    if (!window.confirm(`Delete ${p.number}?`)) return;
    setDB(d => ({...d, purchaseOrders: d.purchaseOrders.filter(x => x.id !== p.id)}));
    log(`Deleted PO ${p.number}`, "Purchase");
  };

  const approvePO = (p: PurchaseOrder) => {
    if (!canApprove) return alert("You don't have permission to approve Purchase Orders.");
    const now = new Date().toISOString();
    const event: POApprovalEvent = { userId: currentUser!.id, userName: currentUser!.name, action: "Approved", timestamp: now };
    const next: PurchaseOrder = {
      ...p,
      approvalStatus: "Approved",
      approvedById: currentUser!.id, approvedByName: currentUser!.name, approvedAt: now,
      rejectionReason: "",
      status: p.status === "Draft" ? "Approved" : p.status,
      approvalHistory: [...(p.approvalHistory || []), event],
    };
    setDB(d => ({...d, purchaseOrders: d.purchaseOrders.map(x => x.id === p.id ? next : x)}));
    log(`Approved PO ${p.number}`, "Purchase");
    setPreview(next);
  };

  const submitReject = () => {
    if (!rejectingId) return;
    const reason = rejectReason.trim();
    if (!reason) return alert("Please provide a rejection reason.");
    const now = new Date().toISOString();
    setDB(d => ({
      ...d,
      purchaseOrders: d.purchaseOrders.map(p => {
        if (p.id !== rejectingId) return p;
        const event: POApprovalEvent = { userId: currentUser!.id, userName: currentUser!.name, action: "Rejected", reason, timestamp: now };
        return {
          ...p,
          approvalStatus: "Rejected",
          rejectionReason: reason,
          approvedById: currentUser!.id, approvedByName: currentUser!.name, approvedAt: now,
          approvalHistory: [...(p.approvalHistory || []), event],
        };
      }),
    }));
    const target = db.purchaseOrders.find(x => x.id === rejectingId);
    log(`Rejected PO ${target?.number} — ${reason}`, "Purchase");
    setRejectingId(null); setRejectReason("");
    setPreview(null);
  };
  const addItem = () => setForm(f => ({...f, items: [...f.items, { itemId: db.items[0]?.id || "", qty: 1, rate: 0, gst: 18, description: "" }]}));
  const updateItem = (i: number, key: string, val: any) => setForm(f => ({...f, items: f.items.map((it, idx) => idx === i ? {...it, [key]: key === "itemId" || key === "description" ? val : Number(val)} : it)}));
  const delItem = (i: number) => setForm(f => ({...f, items: f.items.filter((_, idx) => idx !== i)}));
  const sub = form.items.reduce((s, i) => s + i.qty * i.rate, 0);
  const gstAmount = form.items.reduce((s, i) => s + i.qty * i.rate * ((Number(i.gst) || 0) / 100), 0);
  const total = sub + gstAmount;

  const matchesItemSearch = (item: any, query: string) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const haystack = `${item.name} ${item.category} ${item.unit}`.toLowerCase();
    return q.split(/\s+/).every(term => haystack.includes(term));
  };

  const handleItemType = (rowIndex: number, value: string) => {
    setItemSearch(prev => ({ ...prev, [rowIndex]: value }));
    const match = db.items.find(item =>
      item.name.toLowerCase() === value.toLowerCase()
    );
    if (match) {
      updateItem(rowIndex, "itemId", match.id);
      updateItem(rowIndex, "rate", match.purchaseRate);
    }
  };

  const saveAsDefaultTerms = () => {
    const lines = (form.terms || "").split("\n").map(x => x.replace(/^\s*\d+[.)-]?\s*/, "").trim()).filter(Boolean);
    if (!lines.length) return alert("Enter at least one term to save as default.");
    const now = new Date().toISOString();
    setDB(d => {
      const existing = d.settings.documentFormats || [];
      const poFormat = existing.find((f: any) => f.documentType === "Purchase Order");
      const updatedFormat = {
        ...(poFormat || {
          id: uid(), documentType: "Purchase Order", formatName: "Purchase Order Standard Format", active: true,
          companyName: d.settings.name, address: d.settings.address, gstNo: d.settings.gst,
          contactDetails: `${d.settings.email} | ${d.settings.phone}`, headerContent: "", footerContent: "",
          bankDetails: "", declaration: "", signatureName: "Authorized Signatory", qrCode: true,
          pageSize: "A4", orientation: "Portrait", createdAt: now,
        }),
        active: true,
        terms: lines.map((text, index) => ({ id: `purchase-term-${index + 1}`, text, active: true, order: index + 1 })),
        updatedAt: now,
      };
      return {
        ...d,
        settings: {
          ...d.settings,
          documentFormats: poFormat
            ? existing.map((f: any) => f.id === poFormat.id ? updatedFormat : f)
            : [updatedFormat as any, ...existing],
        },
      };
    });
    log("Updated default purchase order terms", "Purchase");
    alert("Default purchase order terms saved.");
  };

  const approvalBannerHtml = (p: PurchaseOrder): string => {
    const badgeColor = p.approvalStatus === "Approved"
      ? "#059669"
      : p.approvalStatus === "Rejected" ? "#e11d48" : "#f59e0b";
    const label = p.approvalStatus || "Pending";
    const ts = p.approvedAt ? new Date(p.approvedAt).toLocaleString("en-IN") : "";
    const line = p.approvalStatus === "Approved"
      ? `Approved by <b>${p.approvedByName || "—"}</b> on ${ts}`
      : p.approvalStatus === "Rejected"
        ? `Rejected by <b>${p.approvedByName || "—"}</b> on ${ts}${p.rejectionReason ? ` · Reason: ${p.rejectionReason}` : ""}`
        : `Pending approval · created by ${p.createdByName || "—"}`;
    return `
      <div style="border:1px solid ${badgeColor};background:${badgeColor}10;color:#0f172a;padding:10px 12px;border-radius:8px;margin-bottom:12px;display:flex;align-items:center;gap:10px">
        <span style="background:${badgeColor};color:#fff;padding:3px 10px;border-radius:999px;font-weight:700;font-size:11px;letter-spacing:0.5px">${label.toUpperCase()}</span>
        <span style="font-size:12px">${line}</span>
      </div>`;
  };

  const buildPOHtml = (p: PurchaseOrder, opts?: { includeApprovalHistory?: boolean }): string => {
    const includeHistory = opts?.includeApprovalHistory !== false;
    const v = db.parties.find(x => x.id === p.vendorId);
    const sub = p.items.reduce((s, i) => s + i.qty * i.rate, 0);
    const gst = p.items.reduce((s, i) => s + i.qty * i.rate * ((Number(i.gst) || 0) / 100), 0);
    const t = sub + gst;
    const historyRows = (p.approvalHistory || []).map(e => `<tr><td>${new Date(e.timestamp).toLocaleString("en-IN")}</td><td>${e.userName}</td><td>${e.action}</td><td>${e.reason || ""}</td></tr>`).join("");
    const body = `
      ${approvalBannerHtml(p)}
      <div class="box"><div class="section-title">Vendor Details</div><b>${v?.name || ""}</b><br/>${v?.address || ""}${v?.city ? `, ${v.city}` : ""}<br/>GST: ${v?.gst || ""}<br/>Contact: ${v?.mobile || ""} | ${v?.email || ""}</div>
      <div class="box"><span class="badge">${p.status}</span> &nbsp; <b>Expected Delivery:</b> ${p.expectedDeliveryDate || "—"}</div>
      <table><thead><tr><th>#</th><th>Item</th><th class="right">Qty</th><th>Unit</th><th class="right">Rate</th><th class="right">GST%</th><th class="right">Amount</th></tr></thead>
      <tbody>${p.items.map((i, idx) => { const it = db.items.find(x => x.id === i.itemId); const g = Number(i.gst) || 0; const amt = i.qty * i.rate * (1 + g / 100); return `<tr><td>${idx+1}</td><td><b>${it?.name || "-"}</b>${i.description ? `<br/><span class="muted">${i.description}</span>` : ""}</td><td class="right">${i.qty}</td><td>${it?.unit || "-"}</td><td class="right">${fmtINR(i.rate)}</td><td class="right">${g}%</td><td class="right">${fmtINR(amt)}</td></tr>`; }).join("")}</tbody></table>
      <div class="totals">
        <div><span>Sub Total</span><b>${fmtINR(sub)}</b></div>
        <div><span>GST</span><b>${fmtINR(gst)}</b></div>
        <div class="grand"><span>Total</span><b>${fmtINR(t)}</b></div>
      </div>
      <div class="box"><div class="section-title">Terms &amp; Conditions</div><pre style="white-space:pre-wrap;font-family:inherit;font-size:12px;margin:6px 0">${p.terms || getDefaultPurchaseTerms(db.settings)}</pre></div>
      ${includeHistory && historyRows ? `<div class="box"><div class="section-title">Approval History</div><table><thead><tr><th>Date &amp; Time</th><th>User</th><th>Action</th><th>Reason</th></tr></thead><tbody>${historyRows}</tbody></table></div>` : ""}
    `;
    return professionalDocument(db.settings, { title: "Purchase Order", number: p.number, date: p.date, body, accent: "#ea580c", skipFormatTerms: true });
  };

  const printPO = (p: PurchaseOrder) => {
    // Approval history is deliberately excluded from the downloaded/printed PDF —
    // it remains available in the on-screen preview only.
    printArea(buildPOHtml(p, { includeApprovalHistory: false }), p.number);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div><h1 className="text-2xl font-bold">Purchase Orders</h1><p className="text-sm text-slate-500">Procurement from vendors and suppliers</p></div>
        {canCreate && <Button onClick={openNew}><IconPlus size={14}/> New PO</Button>}
      </div>
      <Card>
        <div className="p-3 border-b border-slate-200 dark:border-slate-800">
          <div className="relative max-w-sm">
            <IconSearch size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"/>
            <Input
              value={vendorQuery}
              onChange={(e: any) => setVendorQuery(e.target.value)}
              placeholder="Search by vendor name or PO number..."
              className="pl-9"
              data-testid="po-vendor-search"
            />
          </div>
        </div>
        <Table>
          <thead><tr><Th>#</Th><Th>Date</Th><Th>Vendor</Th><Th>Items</Th><Th>Expected Delivery</Th><Th>Received / Pending</Th><Th>Total</Th><Th>Status</Th><Th></Th></tr></thead>
          <tbody>
            {filteredPOs.map(p => {
              const t = p.items.reduce((s, i) => s + i.qty * i.rate * (1 + ((Number(i.gst) || 0) / 100)), 0);
              const summary = overdueSummary(p, db.grns);
              const showDelay = summary.delayDays > 0 && !summary.fullyReceived && p.status !== "Cancelled";
              const derivedStatus: PurchaseOrder["status"] = summary.fullyReceived
                ? (p.status === "Cancelled" ? p.status : "Completed")
                : p.status;
              return (
                <tr key={p.id} className={"hover:bg-slate-50 dark:hover:bg-slate-800/50 " + (showDelay ? "bg-rose-50/60 dark:bg-rose-900/10" : "")}>
                  <Td>
                    <button
                      type="button"
                      onClick={() => setPreview(p)}
                      className="font-mono text-xs text-indigo-600 hover:text-indigo-800 hover:underline dark:text-indigo-400"
                      data-testid={`po-preview-${p.number}`}
                      title="Open PO preview"
                    >{p.number}</button>
                    <div className="mt-1">
                      {p.approvalStatus === "Approved" && <Badge color="green">Approved</Badge>}
                      {p.approvalStatus === "Rejected" && <Badge color="red">Rejected</Badge>}
                      {(!p.approvalStatus || p.approvalStatus === "Pending") && <Badge color="amber">Pending Approval</Badge>}
                    </div>
                    {p.approvedByName && p.approvedAt && (
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        {p.approvalStatus === "Approved" ? "Approved" : "Rejected"} by {p.approvedByName} · {new Date(p.approvedAt).toLocaleDateString("en-IN")} {new Date(p.approvedAt).toLocaleTimeString("en-IN", {hour: "2-digit", minute: "2-digit"})}
                      </div>
                    )}
                    {p.approvalStatus === "Rejected" && p.rejectionReason && (
                      <div className="text-[10px] text-rose-600 mt-0.5 italic">“{p.rejectionReason}”</div>
                    )}
                  </Td>
                  <Td>{p.date}</Td>
                  <Td>{db.parties.find(v => v.id === p.vendorId)?.name}</Td>
                  <Td>{p.items.length}</Td>
                  <Td>
                    <div>{p.expectedDeliveryDate || <span className="text-slate-400">—</span>}</div>
                    {showDelay && (
                      <div className="text-[11px] font-semibold text-rose-600 flex items-center gap-1" data-testid={`po-delay-${p.number}`}>
                        <span aria-hidden>🔴</span>
                        {summary.delayDays} {summary.delayDays === 1 ? "Day" : "Days"} Delayed
                      </div>
                    )}
                  </Td>
                  <Td>
                    <div className="text-xs">
                      <span className="font-semibold">{summary.received}</span>
                      <span className="text-slate-400"> / </span>
                      <span className={summary.pending > 0 ? "text-amber-600 font-semibold" : "text-emerald-600 font-semibold"}>{summary.pending}</span>
                      <span className="text-slate-400"> of {summary.ordered}</span>
                    </div>
                  </Td>
                  <Td className="font-semibold">{fmtINR(t)}</Td>
                  <Td>
                    <Select disabled={!canEdit && !canApprove} value={derivedStatus} onChange={(e: any) => {
                      setDB(d => ({...d, purchaseOrders: d.purchaseOrders.map(x => x.id === p.id ? {...x, status: e.target.value} : x)}));
                      log(`PO ${p.number} → ${e.target.value}`, "Purchase");
                    }} className="text-xs py-1">
                      <option>Draft</option><option>Approved</option><option>Partially Received</option><option>Completed</option><option>Received</option><option>Cancelled</option>
                    </Select>
                    {summary.fullyReceived && p.status !== "Completed" && p.status !== "Cancelled" && (
                      <div className="text-[10px] text-emerald-600 mt-0.5">Auto-completed via GRN</div>
                    )}
                  </Td>
                  <Td><div className="flex gap-1">
                    {canEdit && <Button size="sm" variant="ghost" disabled={!canEditPO(p)} title={!canEditPO(p) ? "Locked after approval" : ""} onClick={() => openEdit(p)}><IconEdit size={14}/></Button>}
                    {canPrint && <Button size="sm" variant="ghost" onClick={() => setPreview(p)}><IconPrint size={14}/></Button>}
                    {canDelete && <Button size="sm" variant="ghost" onClick={() => remove(p)}><IconTrash size={14}/></Button>}
                  </div></Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        {db.purchaseOrders.length === 0 && <Empty/>}
        {db.purchaseOrders.length > 0 && filteredPOs.length === 0 && (
          <div className="p-6 text-center text-sm text-slate-500" data-testid="po-no-vendor-match">
            No purchase orders match “{vendorQuery}”.
          </div>
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title={edit ? `Edit ${edit.number}` : "New Purchase Order"} size="xl">
        <div className="grid sm:grid-cols-4 gap-3">
          <div><Label>PO No.</Label><Input value={form.number} disabled/></div>
          <div><Label>Date</Label><Input type="date" value={form.date} onChange={(e: any) => {
            const newDate: string = e.target.value;
            // Auto-shift the Expected Delivery when it hasn't been customised
            // (i.e. it's still exactly Date + 10 days, or empty). If the user
            // set it manually, we don't touch it.
            const currentOffsetDefault = addDaysISO(form.date, DEFAULT_LEAD_TIME_DAYS);
            const isStillDefault = !form.expectedDeliveryDate || form.expectedDeliveryDate === currentOffsetDefault;
            setForm({
              ...form,
              date: newDate,
              expectedDeliveryDate: isStillDefault ? addDaysISO(newDate, DEFAULT_LEAD_TIME_DAYS) : form.expectedDeliveryDate,
            });
          }}/></div>
          <div><Label>Vendor</Label>
            <VendorCombobox
              vendors={vendors}
              value={form.vendorId}
              onChange={(id) => setForm({...form, vendorId: id})}
            />
          </div>
          <div>
            <Label>Expected Delivery Date</Label>
            <Input
              type="date"
              value={form.expectedDeliveryDate || ""}
              onChange={(e: any) => setForm({...form, expectedDeliveryDate: e.target.value})}
              data-testid="po-expected-delivery"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Defaults to PO Date + {DEFAULT_LEAD_TIME_DAYS} days.
              {form.date && form.expectedDeliveryDate !== addDaysISO(form.date, DEFAULT_LEAD_TIME_DAYS) && (
                <>
                  {" "}
                  <button
                    type="button"
                    className="underline text-indigo-500 hover:text-indigo-700"
                    onClick={() => setForm({ ...form, expectedDeliveryDate: addDaysISO(form.date, DEFAULT_LEAD_TIME_DAYS) })}
                    data-testid="po-reset-expected"
                  >Reset to default</button>
                </>
              )}
            </p>
          </div>
        </div>
        <div className="mt-3 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
          <Table>
            <thead><tr><Th>Item</Th><Th>Qty</Th><Th>Rate</Th><Th>GST%</Th><Th>Amount</Th><Th></Th></tr></thead>
            <tbody>{form.items.map((it, i) => (
              <tr key={i}>
                <Td>
                  <Input
                    className="mb-1"
                    value={itemSearch[i] ?? ""}
                    list={`po-item-suggestions-${i}`}
                    placeholder="Type item name e.g. COPPER, 100 KVA, 11KV, CT COIL"
                    onChange={(e: any) => handleItemType(i, e.target.value)}
                  />
                  <datalist id={`po-item-suggestions-${i}`}>
                    {db.items.filter(x => matchesItemSearch(x, itemSearch[i] || "")).slice(0, 25).map(x => <option key={x.id} value={x.name}>{x.category} - {x.unit}</option>)}
                  </datalist>
                  <Select value={it.itemId} onChange={(e: any) => {
                    const selected = db.items.find(x => x.id === e.target.value);
                    updateItem(i, "itemId", e.target.value);
                    if (selected) {
                      updateItem(i, "rate", selected.purchaseRate);
                      if (typeof selected.gstRate === "number") updateItem(i, "gst", selected.gstRate);
                      setItemSearch(prev => ({ ...prev, [i]: selected.name }));
                    }
                  }}>
                    {db.items.filter(x => matchesItemSearch(x, itemSearch[i] || "")).map(x => <option key={x.id} value={x.id}>{x.name} - {x.unit}</option>)}
                  </Select>
                  <Input
                    className="mt-2"
                    value={it.description || ""}
                    placeholder="Item Description"
                    onChange={(e: any) => updateItem(i, "description", e.target.value)}
                  />
                </Td>
                <Td><Input type="number" value={it.qty} onChange={(e: any) => updateItem(i, "qty", e.target.value)}/></Td>
                <Td><Input type="number" value={it.rate} onChange={(e: any) => updateItem(i, "rate", e.target.value)}/></Td>
                <Td>
                  <Select
                    value={it.gst ?? 18}
                    onChange={(e: any) => updateItem(i, "gst", e.target.value)}
                    data-testid={`po-item-gst-${i}`}
                  >
                    {[0, 5, 12, 18, 28].map(rate => <option key={rate} value={rate}>{rate}%</option>)}
                  </Select>
                </Td>
                <Td>{fmtINR(it.qty * it.rate * (1 + ((Number(it.gst) || 0) / 100)))}</Td>
                <Td><Button size="sm" variant="ghost" onClick={() => delItem(i)}><IconTrash size={14}/></Button></Td>
              </tr>
            ))}</tbody>
          </Table>
        </div>
        <div className="mt-2 flex items-start justify-between gap-4">
          <Button size="sm" variant="outline" onClick={addItem}><IconPlus size={14}/> Add Item</Button>
          <div className="text-sm w-full sm:w-64 rounded-lg border p-3 bg-slate-50 dark:bg-slate-800/40 dark:border-slate-700 space-y-1">
            <div className="flex justify-between"><span>Sub Total</span><b>{fmtINR(sub)}</b></div>
            <div className="flex justify-between"><span>GST</span><b>{fmtINR(gstAmount)}</b></div>
            <div className="flex justify-between text-base border-t pt-1 mt-1"><span>Total</span><b className="text-emerald-600">{fmtINR(total)}</b></div>
          </div>
        </div>
        <div className="mt-4">
          <div className="flex items-center justify-between mb-1">
            <Label className="mb-0">Editable Default Terms & Conditions</Label>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => setForm({...form, terms: getDefaultPurchaseTerms(db.settings)})}>Load Default Terms</Button>
              {currentUser?.role === "admin" && <Button type="button" size="sm" variant="outline" onClick={saveAsDefaultTerms}>Save as Default</Button>}
            </div>
          </div>
          <Textarea rows={7} value={form.terms || ""} onChange={(e: any) => setForm({...form, terms: e.target.value})}/>
          <p className="mt-1 text-xs text-slate-500">These terms print on the Purchase Order PDF and can be changed for this PO. Admin can save them as default PO terms.</p>
        </div>
        <div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save}>{edit ? (edit.approvalStatus === "Rejected" ? "Save & Resubmit for Approval" : "Update") : "Create"}</Button></div>
      </Modal>

      {/* PO Preview Modal with Approve / Reject */}
      <Modal open={!!preview} onClose={() => setPreview(null)} title={preview ? `${preview.number} — Preview` : "PO Preview"} size="xl">
        {preview && <POPreview
          po={preview}
          html={buildPOHtml(preview)}
          canApprove={canApprove}
          isAdmin={isAdmin}
          onApprove={() => approvePO(preview)}
          onReject={() => { setRejectingId(preview.id); setRejectReason(""); }}
          onPrint={() => printPO(preview)}
          onEdit={() => {
            if (!canEditPO(preview)) return alert("This PO is locked. Only Admin can edit approved orders.");
            setPreview(null);
            openEdit(preview);
          }}
          canEditPO={canEditPO(preview)}
        />}
      </Modal>

      {/* Reject Reason Modal */}
      <Modal open={!!rejectingId} onClose={() => { setRejectingId(null); setRejectReason(""); }} title="Reject Purchase Order" size="sm">
        <div className="space-y-3">
          <Label>Rejection Reason (required)</Label>
          <Textarea rows={4} value={rejectReason} onChange={(e: any) => setRejectReason(e.target.value)} placeholder="Explain why this PO is being rejected..." data-testid="po-reject-reason"/>
          <p className="text-xs text-slate-500">The creator will be able to edit this PO and resubmit it after seeing your reason.</p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => { setRejectingId(null); setRejectReason(""); }}>Cancel</Button>
            <Button onClick={submitReject} data-testid="po-reject-confirm">Reject PO</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function POPreview({
  po, html, canApprove, isAdmin, onApprove, onReject, onPrint, onEdit, canEditPO,
}: {
  po: PurchaseOrder; html: string; canApprove: boolean; isAdmin: boolean;
  onApprove: () => void; onReject: () => void; onPrint: () => void; onEdit: () => void; canEditPO: boolean;
}) {
  const canAct = (canApprove || isAdmin) && (po.approvalStatus !== "Approved");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="text-xs text-slate-500">
          Created by <b>{po.createdByName || "—"}</b> on {new Date(po.createdAt).toLocaleString("en-IN")}
          {po.approvalStatus === "Approved" && po.approvedAt && (
            <>· Approved by <b>{po.approvedByName}</b> on {new Date(po.approvedAt).toLocaleString("en-IN")}</>
          )}
          {po.approvalStatus === "Rejected" && po.approvedAt && (
            <>· Rejected by <b>{po.approvedByName}</b> on {new Date(po.approvedAt).toLocaleString("en-IN")}</>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {canEditPO && po.approvalStatus === "Rejected" && (
            <Button variant="outline" onClick={onEdit} data-testid="po-preview-edit">
              <IconEdit size={14}/> Edit &amp; Resubmit
            </Button>
          )}
          <Button variant="outline" onClick={onPrint} data-testid="po-preview-print">
            <IconPrint size={14}/> Print / Download
          </Button>
          {canAct && (
            <>
              <Button variant="outline" onClick={onReject} data-testid="po-preview-reject" className="!border-rose-300 !text-rose-600 hover:!bg-rose-50">
                Reject
              </Button>
              <Button onClick={onApprove} data-testid="po-preview-approve" className="!bg-emerald-600 hover:!bg-emerald-700">
                <IconCheck size={14}/> Approve
              </Button>
            </>
          )}
        </div>
      </div>
      {po.approvalStatus === "Rejected" && po.rejectionReason && (
        <div className="rounded-lg border border-rose-300 bg-rose-50 dark:bg-rose-900/20 dark:border-rose-800 p-3 text-sm">
          <b className="text-rose-700 dark:text-rose-300">Rejection Reason:</b> <span className="text-rose-700 dark:text-rose-200">{po.rejectionReason}</span>
        </div>
      )}
      <div
        className="rounded-lg overflow-auto border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/60 flex justify-center p-3"
        style={{ maxHeight: "72vh" }}
      >
        <iframe
          title={`PO ${po.number} preview`}
          srcDoc={html}
          className="border border-slate-300 dark:border-slate-700 bg-white shadow"
          style={{
            width: "210mm",
            minWidth: "210mm",
            height: "297mm",
            minHeight: "297mm",
            border: "1px solid #e2e8f0",
            background: "white",
          }}
        />
      </div>
    </div>
  );
}

function POCombobox({
  purchaseOrders, parties, value, onChange, placeholder = "Search PO by number, vendor, status...",
}: {
  purchaseOrders: PurchaseOrder[]; parties: Party[]; value: string; onChange: (id: string) => void; placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const selected = purchaseOrders.find(p => p.id === value) || null;
  const vendorName = (id: string) => parties.find(v => v.id === id)?.name || "";

  const labelFor = (p: PurchaseOrder) => `${p.number} — ${vendorName(p.vendorId)} (${p.status})`;
  const displayText = open ? query : (selected ? labelFor(selected) : "");

  const statusColor: Record<string, "green" | "amber" | "blue" | "slate" | "red"> = {
    "Completed": "green", "Received": "green", "Partially Received": "amber",
    "Approved": "blue", "Draft": "slate", "Cancelled": "red",
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...purchaseOrders].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    if (!q) return sorted;
    return sorted.filter(p =>
      p.number.toLowerCase().includes(q) ||
      vendorName(p.vendorId).toLowerCase().includes(q) ||
      p.status.toLowerCase().includes(q) ||
      (p.date || "").toLowerCase().includes(q),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchaseOrders, query, parties]);

  const pick = (p: PurchaseOrder) => { onChange(p.id); setOpen(false); setQuery(""); };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHighlight(h => Math.min(filtered.length - 1, h + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight(h => Math.max(0, h - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); if (filtered[highlight]) pick(filtered[highlight]); }
    else if (e.key === "Escape") { setOpen(false); setQuery(""); }
  };

  const onBlur = () => {
    setTimeout(() => {
      if (wrapRef.current && !wrapRef.current.contains(document.activeElement)) { setOpen(false); setQuery(""); }
    }, 0);
  };

  return (
    <div className="relative" ref={wrapRef} onBlur={onBlur}>
      <div className="relative">
        <IconSearch size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"/>
        <Input
          className="pl-9"
          value={displayText}
          placeholder={placeholder}
          onFocus={() => { setOpen(true); setHighlight(0); }}
          onChange={(e: any) => { setQuery(e.target.value); setOpen(true); setHighlight(0); }}
          onKeyDown={handleKey}
          data-testid="grn-po-combobox"
        />
      </div>
      {open && (
        <div className="absolute z-30 mt-1 w-full max-h-80 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg">
          {filtered.length === 0 && <div className="p-3 text-sm text-slate-500">No POs match “{query}”.</div>}
          {filtered.map((p, idx) => (
            <button
              type="button"
              key={p.id}
              onMouseDown={(e) => { e.preventDefault(); pick(p); }}
              onMouseEnter={() => setHighlight(idx)}
              data-testid={`grn-po-option-${p.number}`}
              className={"w-full text-left px-3 py-2 flex items-center justify-between gap-3 " + (idx === highlight ? "bg-indigo-50 dark:bg-indigo-900/30" : "hover:bg-slate-50 dark:hover:bg-slate-800/50")}
            >
              <div className="min-w-0">
                <div className="font-medium text-slate-800 dark:text-slate-100 truncate">
                  <span className="font-mono text-xs mr-2 text-slate-500">{p.number}</span>
                  {vendorName(p.vendorId) || "Unknown Vendor"}
                </div>
                <div className="text-xs text-slate-500 truncate">
                  {p.date} · {p.items.length} item{p.items.length !== 1 ? "s" : ""}
                </div>
              </div>
              <Badge color={statusColor[p.status] || "slate"}>{p.status}</Badge>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function GRNPage() {
  const { db, setDB, log, currentUser } = useStore();
  const canCreate = userCan(currentUser, "grn", "create");
  const canEditGrn = userCan(currentUser, "grn", "edit");
  const canDeleteGrn = userCan(currentUser, "grn", "delete");
  const [editGRN, setEditGRN] = useState<GRN | null>(null);
  const [editDraft, setEditDraft] = useState<{ date: string; vendorInvoiceNo: string; vendorInvoiceAmount: number; freightEnabled: boolean; freight: number; freightGst: number; packingEnabled: boolean; packing: number; packingGst: number; items: { itemId: string; qty: number }[] } | null>(null);
  const [auditGRN, setAuditGRN] = useState<string | null>(null);

  const grnAuditEntry = (g: { number: string }, action: GrnAuditEntry["action"], changes: string): GrnAuditEntry => ({
    id: uid(), grnNumber: g.number, action, changes, byName: currentUser?.name || "Unknown", at: new Date().toISOString(),
  });

  const poStatusFor = (grns: GRN[], p?: PurchaseOrder): PurchaseOrder["status"] | undefined => {
    if (!p) return undefined;
    const cum: Record<string, number> = {};
    grns.filter(g => g.poId === p.id).forEach(g => g.receivedItems.forEach(r => { cum[r.itemId] = (cum[r.itemId] || 0) + r.qty; }));
    const full = p.items.every(i => (cum[i.itemId] || 0) >= i.qty);
    const any = p.items.some(i => (cum[i.itemId] || 0) > 0);
    return full ? "Completed" : any ? "Partially Received" : "Approved";
  };

  const openEditGRN = (g: GRN) => {
    setEditGRN(g);
    setEditDraft({
      date: g.date, vendorInvoiceNo: g.vendorInvoiceNo || "", vendorInvoiceAmount: g.vendorInvoiceAmount || 0,
      freightEnabled: !!g.freightEnabled, freight: g.freight || 0, freightGst: g.freightGst ?? 18,
      packingEnabled: !!g.packingEnabled, packing: g.packing || 0, packingGst: g.packingGst ?? 18,
      items: g.receivedItems.map(r => ({ ...r })),
    });
  };

  const saveEditGRN = () => {
    if (!editGRN || !editDraft) return;
    if (editDraft.items.some(r => (Number(r.qty) || 0) < 0)) return alert("Quantities cannot be negative");
    const deltaByItem: Record<string, number> = {};
    editDraft.items.forEach(r => {
      const old = editGRN.receivedItems.find(x => x.itemId === r.itemId)?.qty || 0;
      const delta = (Number(r.qty) || 0) - old;
      if (delta) deltaByItem[r.itemId] = delta;
    });
    const blockers = Object.entries(deltaByItem).map(([itemId, delta]) => {
      const it = db.items.find(i => i.id === itemId);
      const resulting = (it?.currentStock || 0) + delta;
      return resulting < 0 ? `${it?.name || itemId} (stock ${fmt2(it?.currentStock || 0)}, change ${fmt2(delta)})` : null;
    }).filter(Boolean) as string[];
    if (blockers.length) return alert("Cannot save — stock would go negative for:\n" + blockers.join("\n"));

    const changes: string[] = [];
    if (editDraft.date !== editGRN.date) changes.push(`Date ${editGRN.date} → ${editDraft.date}`);
    if ((editDraft.vendorInvoiceNo || "") !== (editGRN.vendorInvoiceNo || "")) changes.push(`Invoice# ${editGRN.vendorInvoiceNo || "—"} → ${editDraft.vendorInvoiceNo || "—"}`);
    if ((Number(editDraft.vendorInvoiceAmount) || 0) !== (editGRN.vendorInvoiceAmount || 0)) changes.push(`Invoice Amt ${fmtINR(editGRN.vendorInvoiceAmount || 0)} → ${fmtINR(Number(editDraft.vendorInvoiceAmount) || 0)}`);
    (["freight", "packing"] as const).forEach(k => {
      const en = `${k}Enabled` as "freightEnabled" | "packingEnabled";
      const gstK = `${k}Gst` as "freightGst" | "packingGst";
      if ((editDraft as any)[en] !== !!editGRN[en] || (Number((editDraft as any)[k]) || 0) !== (editGRN[k] || 0) || (Number((editDraft as any)[gstK]) || 0) !== (editGRN[gstK] || 0)) {
        changes.push(`${k === "freight" ? "Freight" : "Packing"} ${editGRN[en] ? fmtINR(editGRN[k] || 0) : "off"} → ${(editDraft as any)[en] ? fmtINR(Number((editDraft as any)[k]) || 0) : "off"}`);
      }
    });
    editDraft.items.forEach(r => {
      const old = editGRN.receivedItems.find(x => x.itemId === r.itemId)?.qty || 0;
      const nw = Number(r.qty) || 0;
      if (nw !== old) changes.push(`${db.items.find(i => i.id === r.itemId)?.name || r.itemId} qty ${fmt2(old)} → ${fmt2(nw)}`);
    });
    if (!changes.length) { setEditGRN(null); setEditDraft(null); return; }

    const updated: GRN = {
      ...editGRN, date: editDraft.date,
      vendorInvoiceNo: editDraft.vendorInvoiceNo.trim() || undefined,
      vendorInvoiceAmount: Number(editDraft.vendorInvoiceAmount) || undefined,
      freightEnabled: editDraft.freightEnabled, freight: editDraft.freightEnabled ? Number(editDraft.freight) || 0 : 0, freightGst: editDraft.freightEnabled ? Number(editDraft.freightGst) || 0 : 0,
      packingEnabled: editDraft.packingEnabled, packing: editDraft.packingEnabled ? Number(editDraft.packing) || 0 : 0, packingGst: editDraft.packingEnabled ? Number(editDraft.packingGst) || 0 : 0,
      receivedItems: editDraft.items.filter(r => (Number(r.qty) || 0) > 0).map(r => ({ itemId: r.itemId, qty: Number(r.qty) || 0 })),
    };
    setDB(d => {
      const grns = d.grns.map(x => x.id === editGRN.id ? updated : x);
      const items = d.items.map(it => deltaByItem[it.id] ? { ...it, currentStock: (it.currentStock || 0) + deltaByItem[it.id] } : it);
      return {
        ...d, grns, items,
        purchaseOrders: d.purchaseOrders.map(p => p.id === editGRN.poId ? { ...p, status: poStatusFor(grns, p) || p.status } : p),
        grnAudit: [grnAuditEntry(updated, "Edited", changes.join("; ")), ...(d.grnAudit || [])],
      };
    });
    log(`Edited GRN ${editGRN.number}: ${changes.join("; ")}`, "GRN");
    setEditGRN(null); setEditDraft(null);
  };

  const deleteGRN = (g: GRN) => {
    if (!canDeleteGrn) return alert("Permission denied.");
    const blockers = g.receivedItems.map(r => {
      const it = db.items.find(i => i.id === r.itemId);
      return (it?.currentStock || 0) - r.qty < 0 ? `${it?.name || r.itemId} (stock ${fmt2(it?.currentStock || 0)}, GRN qty ${fmt2(r.qty)})` : null;
    }).filter(Boolean) as string[];
    if (blockers.length) return alert(`Cannot delete ${g.number} — reversing it would make stock negative for:\n${blockers.join("\n")}`);
    if (!confirm(`Delete ${g.number}? Received stock will be reversed from Current Stock.`)) return;
    const detail = g.receivedItems.map(r => `${db.items.find(i => i.id === r.itemId)?.name || r.itemId} × ${fmt2(r.qty)}`).join(", ");
    setDB(d => {
      const grns = d.grns.filter(x => x.id !== g.id);
      const items = d.items.map(it => {
        const r = g.receivedItems.find(x => x.itemId === it.id);
        return r ? { ...it, currentStock: Math.max(0, (it.currentStock || 0) - r.qty) } : it;
      });
      return {
        ...d, grns, items,
        purchaseOrders: d.purchaseOrders.map(p => p.id === g.poId ? { ...p, status: poStatusFor(grns, p) || p.status } : p),
        grnAudit: [grnAuditEntry(g, "Deleted", `Reversed stock: ${detail}`), ...(d.grnAudit || [])],
      };
    });
    log(`Deleted GRN ${g.number} (reversed: ${detail})`, "GRN");
  };
  const [open, setOpen] = useState(false);
  const [viewGRN, setViewGRN] = useState<GRN | null>(null);
  const [poId, setPoId] = useState<string>(db.purchaseOrders[0]?.id || "");
  const po = db.purchaseOrders.find(p => p.id === poId);
  const [received, setReceived] = useState<{ itemId: string; qty: number }[]>([]);
  const [qcPassed, setQcPassed] = useState(true);
  const [hideCompleted, setHideCompleted] = useState(true);
  const [freightEnabled, setFreightEnabled] = useState(false);
  const [freight, setFreight] = useState<number>(0);
  const [freightGst, setFreightGst] = useState<number>(18);
  const [grnSearch, setGrnSearch] = useState<string>("");
  const [packingEnabled, setPackingEnabled] = useState(false);
  const [packing, setPacking] = useState<number>(0);
  const [packingGst, setPackingGst] = useState<number>(18);
  const [vendorInvoiceNo, setVendorInvoiceNo] = useState<string>("");
  const [vendorInvoiceAmount, setVendorInvoiceAmount] = useState<number>(0);

  const isFullyReceived = (p: PurchaseOrder): boolean => {
    if (p.status === "Completed" || p.status === "Received" || p.status === "Cancelled") return true;
    const already: Record<string, number> = {};
    db.grns.filter(g => g.poId === p.id).forEach(g => {
      g.receivedItems.forEach(r => { already[r.itemId] = (already[r.itemId] || 0) + (r.qty || 0); });
    });
    return p.items.length > 0 && p.items.every(i => (already[i.itemId] || 0) >= i.qty);
  };

  const visiblePOs = useMemo(() => {
    if (!hideCompleted) return db.purchaseOrders;
    // Keep currently selected PO in list even if it becomes hidden after filtering,
    // so the user isn't confused about a "missing" selection.
    return db.purchaseOrders.filter(p => p.id === poId || !isFullyReceived(p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.purchaseOrders, db.grns, hideCompleted, poId]);

  // Sum of already-received quantities per item across all prior GRNs for a given PO
  const alreadyReceivedByItem = (targetPoId: string): Record<string, number> => {
    const acc: Record<string, number> = {};
    db.grns.filter(g => g.poId === targetPoId).forEach(g => {
      g.receivedItems.forEach(r => { acc[r.itemId] = (acc[r.itemId] || 0) + (r.qty || 0); });
    });
    return acc;
  };

  const initReceivedFromPO = (targetPoId: string) => {
    const target = db.purchaseOrders.find(x => x.id === targetPoId);
    if (!target) { setReceived([]); return; }
    const already = alreadyReceivedByItem(targetPoId);
    setReceived(target.items.map(i => ({
      itemId: i.itemId,
      qty: Math.max(0, i.qty - (already[i.itemId] || 0)),
    })));
  };

  const openNew = () => {
    // Prefer a PO that is not yet fully received
    const openPOs = db.purchaseOrders.filter(p => p.status !== "Cancelled" && p.status !== "Draft" && p.status !== "Completed" && p.status !== "Received");
    const target = openPOs[0] || db.purchaseOrders[0];
    if (!target) return alert("No PO available");
    setPoId(target.id);
    initReceivedFromPO(target.id);
    setQcPassed(true);
    setOpen(true);
  };

  const itemStatus = (poQty: number, already: number, receiveNow: number): { label: "Pending" | "Partially Received" | "Completed"; color: "gray" | "amber" | "green" } => {
    const total = already + Math.max(0, receiveNow || 0);
    if (total <= 0) return { label: "Pending", color: "gray" };
    if (total >= poQty) return { label: "Completed", color: "green" };
    return { label: "Partially Received", color: "amber" };
  };

  const save = () => {
    if (!po) return;
    const already = alreadyReceivedByItem(po.id);
    // Allow received qty to EXCEED PO qty (over-receipts). No balance cap.
    const cleaned = received
      .map(r => {
        const line = po.items.find(i => i.itemId === r.itemId);
        if (!line) return null;
        const q = Math.max(0, Number(r.qty) || 0);
        return q > 0 ? { itemId: r.itemId, qty: q } : null;
      })
      .filter(Boolean) as { itemId: string; qty: number }[];

    if (cleaned.length === 0) return alert("Enter at least one non-zero Receive Now quantity.");

    const grn: GRN = {
      id: uid(), number: nextNumber("GRN", db.grns), date: todayISO(),
      poId, receivedItems: cleaned, qcPassed,
      freightEnabled, freight: freightEnabled ? Number(freight) || 0 : 0,
      freightGst: freightEnabled ? Number(freightGst) || 0 : 0,
      packingEnabled, packing: packingEnabled ? Number(packing) || 0 : 0,
      packingGst: packingEnabled ? Number(packingGst) || 0 : 0,
      vendorInvoiceNo: vendorInvoiceNo.trim() || undefined,
      vendorInvoiceAmount: Number(vendorInvoiceAmount) || undefined,
      createdAt: new Date().toISOString(),
    };

    // Determine new PO status (compare to PO qty)
    const cumulativeAfter: Record<string, number> = { ...already };
    cleaned.forEach(r => { cumulativeAfter[r.itemId] = (cumulativeAfter[r.itemId] || 0) + r.qty; });
    const fullyReceived = po.items.every(i => (cumulativeAfter[i.itemId] || 0) >= i.qty);
    const anyReceived = po.items.some(i => (cumulativeAfter[i.itemId] || 0) > 0);
    const nextStatus: PurchaseOrder["status"] = fullyReceived ? "Completed" : (anyReceived ? "Partially Received" : po.status);

    setDB(d => {
      const items = d.items.map(it => {
        const r = cleaned.find(x => x.itemId === it.id);
        return r ? { ...it, currentStock: it.currentStock + r.qty } : it;
      });
      return {
        ...d, grns: [grn, ...d.grns], items,
        purchaseOrders: d.purchaseOrders.map(p => p.id === poId ? { ...p, status: nextStatus } : p),
        grnAudit: [grnAuditEntry(grn, "Created", `Received: ${cleaned.map(r => `${db.items.find(i => i.id === r.itemId)?.name || r.itemId} × ${fmt2(r.qty)}`).join(", ")}${grn.vendorInvoiceNo ? ` · Inv# ${grn.vendorInvoiceNo}` : ""}`), ...(d.grnAudit || [])],
      };
    });
    log(`GRN ${grn.number} created (PO ${po?.number}) → PO ${nextStatus}`, "GRN");
    // Reset transient GRN charges state
    setFreightEnabled(false); setFreight(0); setFreightGst(18);
    setPackingEnabled(false); setPacking(0); setPackingGst(18);
    setVendorInvoiceNo(""); setVendorInvoiceAmount(0);
    setOpen(false);
  };

  // Bulk update all over-received PO lines at once
  const updatePOQtyBulk = () => {
    if (!po) return;
    const alreadyMap = alreadyReceivedByItem(po.id);
    const updates = po.items
      .map(line => {
        const rec = received.find(r => r.itemId === line.itemId);
        const alr = alreadyMap[line.itemId] || 0;
        const now = Math.max(0, Number(rec?.qty) || 0);
        const balance = Math.max(0, line.qty - alr);
        return now > balance ? { itemId: line.itemId, newQty: alr + now, oldQty: line.qty } : null;
      })
      .filter(Boolean) as { itemId: string; newQty: number; oldQty: number }[];
    if (updates.length === 0) return alert("No over-received lines to update.");
    if (!confirm(`Update PO qty for ${updates.length} over-received line${updates.length === 1 ? "" : "s"}?`)) return;
    setDB(d => ({
      ...d,
      purchaseOrders: d.purchaseOrders.map(p => p.id === po.id
        ? { ...p, items: p.items.map(i => {
            const u = updates.find(x => x.itemId === i.itemId);
            return u ? { ...i, qty: u.newQty } : i;
          }) }
        : p),
    }));
    log(`PO ${po.number} — bulk updated ${updates.length} line qty`, "Procurement");
  };

  // Increase PO line quantity to the current Receive Now value for one item
  const updatePOQtyForItem = (itemId: string) => {
    if (!po) return;
    const rec = received.find(r => r.itemId === itemId);
    const line = po.items.find(i => i.itemId === itemId);
    if (!rec || !line) return;
    const alreadyMap = alreadyReceivedByItem(po.id);
    const already = alreadyMap[itemId] || 0;
    const newPoQty = already + (Number(rec.qty) || 0);
    if (newPoQty <= line.qty) return alert("Receive Now is not more than the current PO quantity — nothing to update.");
    if (!confirm(`Update PO ${po.number} line qty for this item from ${line.qty} to ${newPoQty}?`)) return;
    setDB(d => ({
      ...d,
      purchaseOrders: d.purchaseOrders.map(p => p.id === po.id
        ? { ...p, items: p.items.map(i => i.itemId === itemId ? { ...i, qty: newPoQty } : i) }
        : p),
    }));
    log(`PO ${po.number} line qty updated to ${newPoQty}`, "Procurement");
  };

  const printGRN = (g: GRN) => {
    const p = db.purchaseOrders.find(x => x.id === g.poId);
    const v = p ? db.parties.find(x => x.id === p.vendorId) : null;
    const linesHtml = g.receivedItems.map((ri, idx) => {
      const it = db.items.find(x => x.id === ri.itemId);
      const line = p?.items.find(x => x.itemId === ri.itemId);
      const rate = Number(line?.rate) || 0;
      const gst = Number(line?.gst) || 0;
      const amt = ri.qty * rate * (1 + gst / 100);
      return `<tr>
        <td>${idx + 1}</td>
        <td>${it?.name || "-"}</td>
        <td>${it?.unit || ""}</td>
        <td class="right">${fmt2(ri.qty)}</td>
        <td class="right">${fmtINR(rate)}</td>
        <td class="right">${gst}%</td>
        <td class="right">${fmtINR(amt)}</td>
      </tr>`;
    }).join("");
    const itemsTotal = g.receivedItems.reduce((s, ri) => {
      const line = p?.items.find(x => x.itemId === ri.itemId);
      const rate = Number(line?.rate) || 0;
      const gst = Number(line?.gst) || 0;
      return s + ri.qty * rate * (1 + gst / 100);
    }, 0);
    const fr = Number(g.freight) || 0;
    const frGstAmt = fr * ((Number(g.freightGst) || 0) / 100);
    const pk = Number(g.packing) || 0;
    const pkGstAmt = pk * ((Number(g.packingGst) || 0) / 100);
    const grand = itemsTotal + (g.freightEnabled ? fr + frGstAmt : 0) + (g.packingEnabled ? pk + pkGstAmt : 0);
    const invAmt = Number(g.vendorInvoiceAmount) || 0;
    const invDiff = invAmt - grand;
    const body = `
      <div class="box"><div class="section-title">Received From</div>
        <b>${v?.name || ""}</b><br/>${v?.address || ""}${v?.city ? `, ${v.city}` : ""}<br/>GST: ${v?.gst || ""}
      </div>
      <div class="box"><div class="section-title">Against</div>
        <b>PO:</b> ${p?.number || "-"}<br/>
        <b>QC:</b> ${g.qcPassed ? "Passed" : "Failed"}<br/>
        ${g.vendorInvoiceNo ? `<b>Vendor Invoice No:</b> ${g.vendorInvoiceNo}<br/>` : ""}
        ${invAmt > 0 ? `<b>Vendor Invoice Amount:</b> ${fmtINR(invAmt)}` : ""}
      </div>
      <table>
        <thead><tr><th>#</th><th>Item</th><th>Unit</th><th class="right">Qty</th><th class="right">Rate</th><th class="right">GST%</th><th class="right">Amount</th></tr></thead>
        <tbody>${linesHtml}</tbody>
      </table>
      <table style="margin-top:8px;max-width:360px;margin-left:auto">
        <tr><td>Received Items Total (incl. GST)</td><td class="right">${fmtINR(itemsTotal)}</td></tr>
        ${g.freightEnabled ? `<tr><td>Freight (+ GST ${g.freightGst || 0}%)</td><td class="right">${fmtINR(fr + frGstAmt)}</td></tr>` : ""}
        ${g.packingEnabled ? `<tr><td>Packing (+ GST ${g.packingGst || 0}%)</td><td class="right">${fmtINR(pk + pkGstAmt)}</td></tr>` : ""}
        <tr><td><b>GRN / Invoice Total</b></td><td class="right"><b>${fmtINR(grand)}</b></td></tr>
        ${invAmt > 0 ? `<tr><td>Vendor Invoice</td><td class="right">${fmtINR(invAmt)}</td></tr>
          <tr><td><b>${Math.abs(invDiff) > 0.5 ? "Mismatch" : "Match"}</b></td><td class="right"><b>${invDiff >= 0 ? "+" : ""}${fmtINR(invDiff)}</b></td></tr>` : ""}
      </table>
      <div class="signs"><div class="sign-box">Store Keeper</div><div class="sign-box">QC / Inspector</div><div class="sign-box">Authorized Signatory</div></div>
    `;
    const html = professionalDocument(db.settings, { title: "Goods Receipt Note", number: g.number, date: g.date, body, accent: "#0891b2" });
    printArea(html, g.number);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div><h1 className="text-2xl font-bold">Goods Receipt Notes (GRN)</h1><p className="text-sm text-slate-500">Receive against PO and auto-update inventory</p></div>
        <div className="flex items-center gap-2 flex-wrap">
          <Input
            placeholder="Search by party / vendor / GRN / PO / invoice…"
            value={grnSearch}
            onChange={(e: any) => setGrnSearch(e.target.value)}
            className="w-72"
            data-testid="grn-search"
          />
          {canCreate && <Button onClick={openNew}><IconPlus size={14}/> New GRN</Button>}
        </div>
      </div>
      <Card>
        <Table>
          <thead><tr><Th>#</Th><Th>Date</Th><Th>PO / Vendor</Th><Th>Items</Th><Th>Invoice #</Th><Th className="text-right">Total</Th><Th>QC</Th><Th></Th></tr></thead>
          <tbody>
            {db.grns.filter(g => {
              const q = grnSearch.trim().toLowerCase();
              if (!q) return true;
              const p = db.purchaseOrders.find(x => x.id === g.poId);
              const vendorName = (db.parties.find(v => v.id === p?.vendorId)?.name || "").toLowerCase();
              return vendorName.includes(q)
                || (g.number || "").toLowerCase().includes(q)
                || (p?.number || "").toLowerCase().includes(q)
                || (g.vendorInvoiceNo || "").toLowerCase().includes(q);
            }).map(g => {
              const p = db.purchaseOrders.find(x => x.id === g.poId);
              const itemsTotal = g.receivedItems.reduce((s, ri) => {
                const line = p?.items.find(x => x.itemId === ri.itemId);
                const rate = Number(line?.rate) || 0;
                const gst = Number(line?.gst) || 0;
                return s + ri.qty * rate * (1 + gst / 100);
              }, 0);
              const fr = Number(g.freight) || 0;
              const frGst = fr * ((Number(g.freightGst) || 0) / 100);
              const pk = Number(g.packing) || 0;
              const pkGst = pk * ((Number(g.packingGst) || 0) / 100);
              const grand = itemsTotal + (g.freightEnabled ? fr + frGst : 0) + (g.packingEnabled ? pk + pkGst : 0);
              const invAmt = Number(g.vendorInvoiceAmount) || 0;
              const mismatch = invAmt > 0 && Math.abs(invAmt - grand) > 0.5;
              return (
                <tr key={g.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <Td className="font-mono text-xs">
                    <button
                      className="text-indigo-600 hover:underline"
                      onClick={() => setViewGRN(g)}
                      data-testid={`grn-view-${g.id}`}
                    >{g.number}</button>
                  </Td>
                  <Td>{g.date}</Td>
                  <Td>{p?.number} — {db.parties.find(v => v.id === p?.vendorId)?.name}</Td>
                  <Td>{g.receivedItems.length} items</Td>
                  <Td>
                    {g.vendorInvoiceNo ? (
                      <div>
                        <div className="font-mono text-xs">{g.vendorInvoiceNo}</div>
                        {mismatch && <Badge color="red">Mismatch</Badge>}
                      </div>
                    ) : <span className="text-slate-400 text-xs">—</span>}
                  </Td>
                  <Td className="text-right font-semibold">{fmtINR(grand)}</Td>
                  <Td><Badge color={g.qcPassed ? "green" : "red"}>{g.qcPassed ? "Passed" : "Failed"}</Badge></Td>
                  <Td>
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" title="Print GRN" onClick={() => printGRN(g)} data-testid={`grn-print-${g.id}`}><IconPrint size={14}/></Button>
                      <Button size="sm" variant="ghost" title="GRN Audit History" onClick={() => setAuditGRN(g.number)} data-testid={`grn-audit-${g.id}`}><IconHistory size={14}/></Button>
                      {canEditGrn && <Button size="sm" variant="ghost" title="Edit GRN" onClick={() => openEditGRN(g)} data-testid={`grn-edit-${g.id}`}><IconEdit size={14}/></Button>}
                      {canDeleteGrn && <Button size="sm" variant="ghost" title="Delete GRN (reverses stock)" className="text-rose-600 hover:text-rose-700" onClick={() => deleteGRN(g)} data-testid={`grn-delete-${g.id}`}><IconTrash size={14}/></Button>}
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        {db.grns.length === 0 && <Empty title="No GRN yet" subtitle="Create a GRN against an Approved PO"/>}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="New Goods Receipt Note" size="lg">
        <div className="space-y-3">
          <div>
            <div className="flex items-center justify-between gap-2">
              <Label>Select PO</Label>
              <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer select-none" data-testid="grn-hide-completed-toggle">
                <input
                  type="checkbox"
                  className="rounded"
                  checked={hideCompleted}
                  onChange={e => setHideCompleted(e.target.checked)}
                />
                Hide fully received
              </label>
            </div>
            <POCombobox
              purchaseOrders={visiblePOs}
              parties={db.parties}
              value={poId}
              onChange={(id) => { setPoId(id); initReceivedFromPO(id); }}
            />
            {visiblePOs.length === 0 && (
              <div className="mt-2 text-xs text-slate-500">
                No pending POs. Untick “Hide fully received” to see completed orders.
              </div>
            )}
          </div>
          {po && (() => {
            const already = alreadyReceivedByItem(po.id);
            const grandItemsTotal = po.items.reduce((s, oi) => {
              const rec = received.find(x => x.itemId === oi.itemId);
              const q = Math.max(0, Number(rec?.qty) || 0);
              return s + q * (Number(oi.rate) || 0) * (1 + ((Number(oi.gst) || 0) / 100));
            }, 0);
            const fr = freightEnabled ? (Number(freight) || 0) : 0;
            const frGst = freightEnabled ? fr * ((Number(freightGst) || 0) / 100) : 0;
            const pk = packingEnabled ? (Number(packing) || 0) : 0;
            const pkGst = packingEnabled ? pk * ((Number(packingGst) || 0) / 100) : 0;
            const grand = grandItemsTotal + fr + frGst + pk + pkGst;
            const overCount = po.items.filter(oi => {
              const rec = received.find(x => x.itemId === oi.itemId);
              const alr = already[oi.itemId] || 0;
              const balance = Math.max(0, oi.qty - alr);
              return (Number(rec?.qty) || 0) > balance;
            }).length;
            const invAmt = Number(vendorInvoiceAmount) || 0;
            const invDiff = invAmt > 0 ? invAmt - grand : 0;
            const invMismatch = invAmt > 0 && Math.abs(invDiff) > 0.5;
            return (
              <>
                <Table>
                  <thead><tr><Th>Item</Th><Th>PO Qty</Th><Th className="text-right">Rate</Th><Th>Already Received</Th><Th>Balance</Th><Th>Receive Now</Th><Th>Status</Th><Th></Th></tr></thead>
                  <tbody>
                    {po.items.map((oi, idx) => {
                      const it = db.items.find(x => x.id === oi.itemId);
                      const r = received.find(x => x.itemId === oi.itemId);
                      const alr = already[oi.itemId] || 0;
                      const balance = Math.max(0, oi.qty - alr);
                      const now = Math.max(0, Number(r?.qty) || 0);
                      const st = itemStatus(oi.qty, alr, now);
                      const isOver = now > balance;
                      return (
                        <tr key={idx} className={isOver ? "bg-amber-50 dark:bg-amber-900/20" : ""}>
                          <Td>{it?.name}</Td>
                          <Td>{fmt2(oi.qty)} {it?.unit}</Td>
                          <Td className="text-right font-medium" data-testid={`grn-rate-${oi.itemId}`}>{fmtINR(Number(oi.rate) || 0)}<div className="text-[9px] text-slate-400">as per PO</div></Td>
                          <Td>{fmt2(alr)} {it?.unit}</Td>
                          <Td className="font-semibold">{fmt2(balance)} {it?.unit}</Td>
                          <Td>
                            <Input
                              type="number"
                              min={0}
                              value={r?.qty ?? 0}
                              onChange={(e: any) => {
                                const raw = Number(e.target.value);
                                const q = isNaN(raw) ? 0 : Math.max(0, raw);
                                setReceived(prev => {
                                  const exists = prev.some(x => x.itemId === oi.itemId);
                                  return exists
                                    ? prev.map(x => x.itemId === oi.itemId ? { ...x, qty: q } : x)
                                    : [...prev, { itemId: oi.itemId, qty: q }];
                                });
                              }}
                              data-testid={`grn-receive-${oi.itemId}`}
                            />
                            {isOver && (
                              <div className="text-[10px] text-amber-700 dark:text-amber-300 mt-1">
                                Over-receipt: {fmt2(now - balance)} extra {it?.unit || ""}
                              </div>
                            )}
                          </Td>
                          <Td><Badge color={st.color as any}>{st.label}</Badge></Td>
                          <Td>
                            {isOver && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => updatePOQtyForItem(oi.itemId)}
                                data-testid={`grn-update-po-${oi.itemId}`}
                                title="Increase PO qty to match received"
                              >
                                Update PO Qty
                              </Button>
                            )}
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>

                {overCount >= 2 && (
                  <div className="mt-3 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-3 flex items-center justify-between gap-3 text-sm">
                    <div>
                      <b>{overCount}</b> line{overCount === 1 ? "" : "s"} received above PO qty. Bulk-update the PO to match?
                    </div>
                    <Button size="sm" variant="outline" onClick={updatePOQtyBulk} data-testid="grn-update-po-bulk">
                      Update All Over-Received Lines
                    </Button>
                  </div>
                )}

                <div className="mt-4 grid sm:grid-cols-2 gap-3">
                  <div className="rounded-lg border p-3 bg-slate-50 dark:bg-slate-800/40 dark:border-slate-700 space-y-2">
                    <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Additional Charges</div>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={freightEnabled} onChange={(e) => setFreightEnabled(e.target.checked)} data-testid="grn-freight-toggle" />
                      <span>Freight Charges</span>
                      {freightEnabled && (
                        <>
                          <Input type="number" value={freight} onChange={(e: any) => setFreight(Number(e.target.value) || 0)} className="ml-auto w-24 text-right py-1 h-8" data-testid="grn-freight" placeholder="Amount" />
                          <Select value={freightGst} onChange={(e: any) => setFreightGst(Number(e.target.value) || 0)} className="w-20 py-1 h-8" data-testid="grn-freight-gst">
                            {[0, 5, 12, 18, 28].map(g => <option key={g} value={g}>{g}%</option>)}
                          </Select>
                        </>
                      )}
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={packingEnabled} onChange={(e) => setPackingEnabled(e.target.checked)} data-testid="grn-packing-toggle" />
                      <span>Packing Charges</span>
                      {packingEnabled && (
                        <>
                          <Input type="number" value={packing} onChange={(e: any) => setPacking(Number(e.target.value) || 0)} className="ml-auto w-24 text-right py-1 h-8" data-testid="grn-packing" placeholder="Amount" />
                          <Select value={packingGst} onChange={(e: any) => setPackingGst(Number(e.target.value) || 0)} className="w-20 py-1 h-8" data-testid="grn-packing-gst">
                            {[0, 5, 12, 18, 28].map(g => <option key={g} value={g}>{g}%</option>)}
                          </Select>
                        </>
                      )}
                    </label>
                    <div className="text-[11px] text-slate-500 pt-1 border-t border-slate-200 dark:border-slate-700">
                      GST on each charge is optional — matches supplier invoices that tax freight/packing separately.
                    </div>
                  </div>

                  <div className="rounded-lg border p-3 bg-slate-50 dark:bg-slate-800/40 dark:border-slate-700 text-sm space-y-1">
                    <div className="flex justify-between"><span>Received Items Total (incl. GST)</span><b>{fmtINR(grandItemsTotal)}</b></div>
                    <div className="flex justify-between"><span>Freight {freightEnabled ? `(+ GST ${freightGst}%)` : ""}</span><b>{freightEnabled ? fmtINR(fr + frGst) : "—"}</b></div>
                    <div className="flex justify-between"><span>Packing {packingEnabled ? `(+ GST ${packingGst}%)` : ""}</span><b>{packingEnabled ? fmtINR(pk + pkGst) : "—"}</b></div>
                    <div className="flex justify-between text-base border-t pt-1 mt-1">
                      <span>GRN / Invoice Total</span>
                      <b className="text-emerald-600" data-testid="grn-grand-total">{fmtINR(grand)}</b>
                    </div>
                  </div>
                </div>

                <div className={"mt-3 rounded-lg border p-3 " + (invMismatch ? "border-rose-300 dark:border-rose-700 bg-rose-50 dark:bg-rose-900/20" : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40")}>
                  <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">Vendor Invoice Match</div>
                  <div className="grid sm:grid-cols-3 gap-3 text-sm">
                    <div>
                      <Label>Invoice No.</Label>
                      <Input value={vendorInvoiceNo} onChange={(e: any) => setVendorInvoiceNo(e.target.value)} placeholder="e.g. INV-2026-1201" data-testid="grn-vendor-invoice-no" />
                    </div>
                    <div>
                      <Label>Invoice Amount</Label>
                      <Input type="number" value={vendorInvoiceAmount} onChange={(e: any) => setVendorInvoiceAmount(Number(e.target.value) || 0)} data-testid="grn-vendor-invoice-amount" />
                    </div>
                    <div className="flex items-end">
                      {invAmt > 0 ? (
                        invMismatch ? (
                          <Badge color="red">Mismatch: {invDiff > 0 ? "+" : ""}{fmtINR(invDiff)}</Badge>
                        ) : (
                          <Badge color="green">Matches GRN total</Badge>
                        )
                      ) : (
                        <span className="text-xs text-slate-500">Enter supplier invoice amount to compare</span>
                      )}
                    </div>
                  </div>
                </div>
              </>
            );
          })()}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={qcPassed} onChange={e => setQcPassed(e.target.checked)} className="rounded"/>
            Quality Check Passed
          </label>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save}>Receive & Update Stock</Button></div>
        </div>
      </Modal>

      <Modal open={!!viewGRN} onClose={() => setViewGRN(null)} title={viewGRN ? `GRN Details · ${viewGRN.number}` : ""} size="xl">
        {viewGRN && (() => {
          const g = viewGRN;
          const p = db.purchaseOrders.find(x => x.id === g.poId);
          const v = p ? db.parties.find(x => x.id === p.vendorId) : null;
          const itemsTotal = g.receivedItems.reduce((s, ri) => {
            const line = p?.items.find(x => x.itemId === ri.itemId);
            return s + ri.qty * (Number(line?.rate) || 0) * (1 + ((Number(line?.gst) || 0) / 100));
          }, 0);
          const fr = Number(g.freight) || 0;
          const frGst = fr * ((Number(g.freightGst) || 0) / 100);
          const pk = Number(g.packing) || 0;
          const pkGst = pk * ((Number(g.packingGst) || 0) / 100);
          const grand = itemsTotal + (g.freightEnabled ? fr + frGst : 0) + (g.packingEnabled ? pk + pkGst : 0);
          const invAmt = Number(g.vendorInvoiceAmount) || 0;
          const invDiff = invAmt - grand;
          return (
            <div className="space-y-3">
              <div className="grid sm:grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-slate-50 dark:bg-slate-800/40">
                  <div className="text-xs text-slate-500 mb-1">Purchase Order</div>
                  <div className="font-semibold">{p?.number || "—"}</div>
                  <div className="mt-2 text-xs text-slate-500">Vendor</div>
                  <div>{v?.name || "—"}</div>
                  {v?.gst && <div className="text-xs text-slate-500 mt-1">GST: {v.gst}</div>}
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-slate-50 dark:bg-slate-800/40">
                  <div className="flex items-center justify-between"><div><div className="text-xs text-slate-500">GRN Date</div><div className="font-semibold">{g.date}</div></div><Badge color={g.qcPassed ? "green" : "red"}>QC {g.qcPassed ? "Passed" : "Failed"}</Badge></div>
                  {g.vendorInvoiceNo && <div className="mt-2 text-xs text-slate-500">Vendor Invoice</div>}
                  {g.vendorInvoiceNo && <div className="font-mono text-sm">{g.vendorInvoiceNo}</div>}
                  {invAmt > 0 && (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-xs text-slate-500">Invoice ₹</span>
                      <b>{fmtINR(invAmt)}</b>
                      {Math.abs(invDiff) > 0.5
                        ? <Badge color="red">{invDiff > 0 ? "+" : ""}{fmtINR(invDiff)}</Badge>
                        : <Badge color="green">Match</Badge>}
                    </div>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                <Table>
                  <thead><tr><Th>Item</Th><Th className="text-right">PO Qty</Th><Th className="text-right">Received</Th><Th className="text-right">Balance</Th><Th className="text-right">Rate</Th><Th className="text-right">GST%</Th><Th className="text-right">Amount</Th></tr></thead>
                  <tbody>
                    {g.receivedItems.map((ri, idx) => {
                      const it = db.items.find(x => x.id === ri.itemId);
                      const line = p?.items.find(x => x.itemId === ri.itemId);
                      const poQty = Number(line?.qty) || 0;
                      const rate = Number(line?.rate) || 0;
                      const gst = Number(line?.gst) || 0;
                      const amt = ri.qty * rate * (1 + gst / 100);
                      const balance = Math.max(0, poQty - ri.qty);
                      return (
                        <tr key={idx}>
                          <Td className="font-medium">{it?.name || "—"} <span className="text-xs text-slate-500">({it?.unit || ""})</span></Td>
                          <Td className="text-right">{fmt2(poQty)}</Td>
                          <Td className="text-right font-semibold">{fmt2(ri.qty)}</Td>
                          <Td className="text-right">{fmt2(balance)}</Td>
                          <Td className="text-right">{fmtINR(rate)}</Td>
                          <Td className="text-right">{gst}%</Td>
                          <Td className="text-right font-semibold">{fmtINR(amt)}</Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              </div>

              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-slate-50 dark:bg-slate-800/40 max-w-md ml-auto text-sm space-y-1">
                <div className="flex justify-between"><span>Received Items Total (incl. GST)</span><b>{fmtINR(itemsTotal)}</b></div>
                {g.freightEnabled && <div className="flex justify-between"><span>Freight (+ GST {g.freightGst || 0}%)</span><b>{fmtINR(fr + frGst)}</b></div>}
                {g.packingEnabled && <div className="flex justify-between"><span>Packing (+ GST {g.packingGst || 0}%)</span><b>{fmtINR(pk + pkGst)}</b></div>}
                <div className="flex justify-between text-base border-t pt-1 mt-1"><span><b>GRN Total</b></span><b className="text-emerald-600">{fmtINR(grand)}</b></div>
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setViewGRN(null)}>Close</Button>
                <Button onClick={() => printGRN(g)} data-testid="grn-view-print"><IconPrint size={14}/> Print / Download</Button>
              </div>
            </div>
          );
        })()}
      </Modal>

      <Modal open={!!editGRN && !!editDraft} onClose={() => { setEditGRN(null); setEditDraft(null); }} title={editGRN ? `Edit GRN — ${editGRN.number}` : ""} size="lg">
        {editGRN && editDraft && (
          <div className="space-y-4" data-testid="grn-edit-modal">
            <div className="grid sm:grid-cols-3 gap-3">
              <div><Label>GRN Date</Label><Input type="date" value={editDraft.date} onChange={(e: any) => setEditDraft({ ...editDraft, date: e.target.value })} data-testid="grn-edit-date" /></div>
              <div><Label>Vendor Invoice #</Label><Input value={editDraft.vendorInvoiceNo} onChange={(e: any) => setEditDraft({ ...editDraft, vendorInvoiceNo: e.target.value })} data-testid="grn-edit-invno" /></div>
              <div><Label>Vendor Invoice Amount (₹)</Label><Input type="number" value={editDraft.vendorInvoiceAmount || ""} onChange={(e: any) => setEditDraft({ ...editDraft, vendorInvoiceAmount: Number(e.target.value) || 0 })} data-testid="grn-edit-invamt" /></div>
            </div>
            <div>
              <Label>Received Quantities (stock recalculates automatically)</Label>
              <Table>
                <thead><tr><Th>Item</Th><Th className="text-right">PO Rate</Th><Th className="text-right">Received Qty</Th><Th className="text-right">Current Stock</Th></tr></thead>
                <tbody>
                  {editDraft.items.map((r, idx) => {
                    const it = db.items.find(i => i.id === r.itemId);
                    const poLine = db.purchaseOrders.find(p => p.id === editGRN.poId)?.items.find(x => x.itemId === r.itemId);
                    const old = editGRN.receivedItems.find(x => x.itemId === r.itemId)?.qty || 0;
                    const delta = (Number(r.qty) || 0) - old;
                    const resulting = (it?.currentStock || 0) + delta;
                    return (
                      <tr key={r.itemId}>
                        <Td className="font-medium">{it?.name || "—"} <span className="text-xs text-slate-500">({it?.unit})</span></Td>
                        <Td className="text-right">{fmtINR(Number(poLine?.rate) || 0)}</Td>
                        <Td className="text-right">
                          <Input type="number" min="0" className="!w-28 ml-auto text-right" value={r.qty}
                            onChange={(e: any) => setEditDraft({ ...editDraft, items: editDraft.items.map((x, i) => i === idx ? { ...x, qty: Number(e.target.value) } : x) })}
                            data-testid={`grn-edit-qty-${idx}`} />
                        </Td>
                        <Td className={"text-right font-semibold " + (resulting < 0 ? "text-rose-600" : "text-emerald-600")}>{fmt2(resulting)} {it?.unit}{resulting < 0 && <div className="text-[9px]">would go negative!</div>}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={editDraft.freightEnabled} onChange={(e: any) => setEditDraft({ ...editDraft, freightEnabled: e.target.checked })} data-testid="grn-edit-freight-en" /> Freight Charges</label>
                {editDraft.freightEnabled && (
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label className="text-[10px]">Amount (₹)</Label><Input type="number" value={editDraft.freight || ""} onChange={(e: any) => setEditDraft({ ...editDraft, freight: Number(e.target.value) || 0 })} data-testid="grn-edit-freight" /></div>
                    <div><Label className="text-[10px]">GST %</Label><Input type="number" value={editDraft.freightGst || ""} onChange={(e: any) => setEditDraft({ ...editDraft, freightGst: Number(e.target.value) || 0 })} /></div>
                  </div>
                )}
              </div>
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={editDraft.packingEnabled} onChange={(e: any) => setEditDraft({ ...editDraft, packingEnabled: e.target.checked })} data-testid="grn-edit-packing-en" /> Packing Charges</label>
                {editDraft.packingEnabled && (
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label className="text-[10px]">Amount (₹)</Label><Input type="number" value={editDraft.packing || ""} onChange={(e: any) => setEditDraft({ ...editDraft, packing: Number(e.target.value) || 0 })} data-testid="grn-edit-packing" /></div>
                    <div><Label className="text-[10px]">GST %</Label><Input type="number" value={editDraft.packingGst || ""} onChange={(e: any) => setEditDraft({ ...editDraft, packingGst: Number(e.target.value) || 0 })} /></div>
                  </div>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-700">
              <Button variant="outline" onClick={() => { setEditGRN(null); setEditDraft(null); }}>Cancel</Button>
              <Button onClick={saveEditGRN} data-testid="grn-edit-save">Save Changes</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!auditGRN} onClose={() => setAuditGRN(null)} title={`Audit History — ${auditGRN || ""}`} size="lg">
        <div data-testid="grn-audit-modal">
          <Table>
            <thead><tr><Th>Date & Time</Th><Th>User</Th><Th>Action</Th><Th>Old → New / Details</Th></tr></thead>
            <tbody>
              {(db.grnAudit || []).filter(a => a.grnNumber === auditGRN).map(a => (
                <tr key={a.id}>
                  <Td className="text-xs font-mono">{new Date(a.at).toLocaleString("en-IN")}</Td>
                  <Td>{a.byName}</Td>
                  <Td><Badge color={a.action === "Created" ? "green" : a.action === "Edited" ? "yellow" : "red"}>{a.action}</Badge></Td>
                  <Td className="text-xs text-slate-600 dark:text-slate-300">{a.changes}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {!(db.grnAudit || []).some(a => a.grnNumber === auditGRN) && <Empty title="No audit entries yet" subtitle="Created/Edited/Deleted actions on this GRN will appear here" />}
          <div className="flex justify-end mt-3"><Button variant="outline" onClick={() => setAuditGRN(null)}>Close</Button></div>
        </div>
      </Modal>
    </div>
  );
}
