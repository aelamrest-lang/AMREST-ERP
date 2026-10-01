import { useState, useMemo } from "react";
import { useStore, uid } from "../lib/store";
import { Card, Button, Input, Select, Label, Modal, Table, Th, Td, Badge, Empty, KPI } from "../components/ui";
import type { Party } from "../lib/types";
import { IconPlus, IconEdit, IconTrash, IconSearch, IconDownload, IconBox, IconClipboard, IconRefresh, IconFile } from "../components/icons";
import { downloadCSV, fmtINR, fmt2, todayISO } from "../lib/utils";
import { userCan } from "../lib/permissions";

type HistPeriod = "3m" | "6m" | "1y" | "custom";

function PartyHistoryModal({ party, onClose }: { party: Party; onClose: () => void }) {
  const { db } = useStore();
  const isVendor = party.type === "vendor" || party.type === "supplier";
  const [period, setPeriod] = useState<HistPeriod>("1y");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const range = useMemo(() => {
    if (period === "custom") return { from: from || "0000-01-01", to: to || "9999-12-31" };
    const months = period === "3m" ? 3 : period === "6m" ? 6 : 12;
    const d = new Date(); d.setMonth(d.getMonth() - months);
    return { from: d.toISOString().slice(0, 10), to: todayISO() };
  }, [period, from, to]);

  const inRange = (date: string) => date >= range.from && date <= range.to;

  const purchaseRows = useMemo(() => {
    if (!isVendor) return [];
    return db.purchaseOrders
      .filter(p => p.vendorId === party.id && inRange(p.date))
      .flatMap(p => p.items.map(line => {
        const item = db.items.find(i => i.id === line.itemId);
        const receivedQty = db.grns.filter(g => g.poId === p.id).flatMap(g => g.receivedItems).filter(r => r.itemId === line.itemId).reduce((s, r) => s + r.qty, 0);
        const grnStatus = receivedQty >= line.qty ? "Fully Received" : receivedQty > 0 ? `Partial (${fmt2(receivedQty)}/${fmt2(line.qty)})` : "Pending";
        return {
          id: `${p.id}-${line.itemId}`, date: p.date, ref: p.number, item: item?.name || "—", qty: line.qty,
          unit: item?.unit || "", rate: line.rate, gst: line.gst ?? 18,
          amount: line.qty * line.rate * (1 + (line.gst ?? 18) / 100), grnStatus, status: p.status,
        };
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [db, party.id, isVendor, range]);

  const salesRows = useMemo(() => {
    if (isVendor) return [];
    return db.salesOrders
      .filter(s => s.customerId === party.id && inRange(s.date))
      .flatMap(s => s.items.map((line, idx) => ({
        id: `${s.id}-${idx}`, date: s.date, ref: s.number, item: line.name, qty: line.qty,
        unit: "Nos", rate: line.rate, gst: line.gst ?? 18,
        amount: line.qty * line.rate * (1 + (line.gst ?? 18) / 100), status: s.status,
      })))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [db, party.id, isVendor, range]);

  const rows = isVendor ? purchaseRows : salesRows;
  const totalValue = rows.reduce((s, r) => s + r.amount, 0);
  const totalTxns = rows.length;
  const lastDate = rows[0]?.date || "—";
  const pendingAmount = useMemo(() => {
    if (isVendor) {
      return db.purchaseOrders
        .filter(p => p.vendorId === party.id && (p.status === "Approved" || p.status === "Partially Received"))
        .reduce((s, p) => s + p.items.reduce((ss, line) => {
          const rec = db.grns.filter(g => g.poId === p.id).flatMap(g => g.receivedItems).filter(r => r.itemId === line.itemId).reduce((x, r) => x + r.qty, 0);
          return ss + Math.max(0, line.qty - rec) * line.rate * (1 + (line.gst ?? 18) / 100);
        }, 0), 0);
    }
    return db.salesOrders
      .filter(s => s.customerId === party.id && s.status !== "Delivered")
      .reduce((s, so) => s + so.items.reduce((ss, l) => ss + l.qty * l.rate * (1 + (l.gst ?? 18) / 100), 0), 0);
  }, [db, party.id, isVendor]);

  return (
    <Modal open={true} onClose={onClose} title={`${isVendor ? "Purchase" : "Sales"} History — ${party.name}`} size="xl">
      <div className="space-y-4" data-testid="party-history-modal">
        <div className="flex flex-wrap items-center gap-2">
          {([["3m", "Last 3 Months"], ["6m", "Last 6 Months"], ["1y", "Last 1 Year"], ["custom", "Custom Range"]] as const).map(([k, lbl]) => (
            <button key={k} type="button" onClick={() => setPeriod(k)}
              className={"text-xs px-3 py-1.5 rounded-full border font-medium " + (period === k ? "bg-indigo-600 border-indigo-600 text-white" : "bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-600 hover:border-indigo-400")}
              data-testid={`party-hist-${k}`}>{lbl}</button>
          ))}
          {period === "custom" && (
            <>
              <Input type="date" className="!w-40" value={from} onChange={(e: any) => setFrom(e.target.value)} data-testid="party-hist-from" />
              <span className="text-xs text-slate-400">to</span>
              <Input type="date" className="!w-40" value={to} onChange={(e: any) => setTo(e.target.value)} data-testid="party-hist-to" />
            </>
          )}
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KPI label={isVendor ? "Total Purchase Value" : "Total Sales Value"} value={fmtINR(totalValue)} color="indigo" icon={<IconBox size={20}/>} hint="incl. GST, in range"/>
          <KPI label="Total Transactions" value={String(totalTxns)} color="blue" icon={<IconClipboard size={20}/>} hint="line items in range"/>
          <KPI label="Pending Amount" value={fmtINR(pendingAmount)} color="amber" icon={<IconRefresh size={20}/>} hint={isVendor ? "PO balance to receive" : "SO not yet delivered"}/>
          <KPI label="Last Transaction" value={lastDate} color="emerald" icon={<IconFile size={20}/>} hint="in range"/>
        </div>

        <Table>
          <thead><tr>
            <Th>Date</Th><Th>{isVendor ? "PO No." : "SO / Invoice No."}</Th><Th>Item</Th>
            <Th className="text-right">Qty</Th><Th>Unit</Th><Th className="text-right">Rate</Th><Th className="text-right">GST</Th><Th className="text-right">Amount</Th>
            <Th>{isVendor ? "GRN Status" : "Status"}</Th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <Td className="font-mono text-xs">{r.date}</Td>
                <Td className="font-mono text-xs text-indigo-600">{r.ref}</Td>
                <Td className="font-medium">{r.item}</Td>
                <Td className="text-right">{fmt2(r.qty)}</Td>
                <Td>{r.unit}</Td>
                <Td className="text-right">{fmtINR(r.rate)}</Td>
                <Td className="text-right">{r.gst}%</Td>
                <Td className="text-right font-semibold">{fmtINR(r.amount)}</Td>
                <Td>
                  {isVendor
                    ? <Badge color={r.grnStatus === "Fully Received" ? "green" : r.grnStatus === "Pending" ? "red" : "yellow"}>{r.grnStatus}</Badge>
                    : <Badge color={(r as any).status === "Delivered" ? "green" : (r as any).status === "Dispatched" ? "blue" : "yellow"}>{(r as any).status}</Badge>}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {rows.length === 0 && <Empty title={`No ${isVendor ? "purchase" : "sales"} transactions in this period`} subtitle="Try a wider date range" />}
        <div className="flex justify-end"><Button variant="outline" onClick={onClose}>Close</Button></div>
      </div>
    </Modal>
  );
}

export function Parties() {
  const { db, setDB, currentUser, log } = useStore();
  const isAdmin = currentUser?.role === "admin";
  const canCreate = userCan(currentUser, "parties", "create");
  const canEdit = userCan(currentUser, "parties", "edit");
  const canDelete = userCan(currentUser, "parties", "delete");
  const canExport = userCan(currentUser, "parties", "export");
  const allowedTypes: Party["type"][] = currentUser?.role === "purchase" ? ["vendor", "supplier"] : currentUser?.role === "sales" ? ["customer"] : ["customer", "vendor", "supplier"];
  const [search, setSearch] = useState("");
  const [type, setType] = useState<"all" | Party["type"]>("all");
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<Party | null>(null);
  const [historyParty, setHistoryParty] = useState<Party | null>(null);

  const parties = useMemo(() => {
    let p = isAdmin ? db.parties : db.parties.filter(x => x.ownerId === currentUser?.id);
    p = p.filter(x => allowedTypes.includes(x.type));
    if (type !== "all") p = p.filter(x => x.type === type);
    if (search) {
      const s = search.toLowerCase();
      p = p.filter(x => x.name.toLowerCase().includes(s) || (x.gst || "").toLowerCase().includes(s) || (x.mobile || "").includes(s) || (x.city || "").toLowerCase().includes(s));
    }
    return p;
  }, [db.parties, isAdmin, currentUser, allowedTypes, type, search]);

  const blank: Party = { id: "", name: "", type: allowedTypes[0], gst: "", address: "", city: "", contactPerson: "", mobile: "", email: "", paymentTerms: "30 days", creditLimit: 0, ownerId: currentUser!.id, createdAt: new Date().toISOString() };
  const [form, setForm] = useState<Party>(blank);

  const openNew = () => { setEdit(null); setForm({ ...blank, ownerId: currentUser!.id }); setOpen(true); };
  const openEdit = (p: Party) => { setEdit(p); setForm(p); setOpen(true); };

  const save = () => {
    if (!form.name) return alert("Party name is required");
    if (edit) {
      setDB(d => ({ ...d, parties: d.parties.map(p => p.id === edit.id ? form : p) }));
      log(`Updated party: ${form.name}`, "Party Master");
    } else {
      const np = { ...form, id: uid(), createdAt: new Date().toISOString() };
      setDB(d => ({ ...d, parties: [np, ...d.parties] }));
      log(`Created party: ${form.name}`, "Party Master");
    }
    setOpen(false);
  };

  const remove = (p: Party) => {
    if (!confirm(`Delete party "${p.name}"?`)) return;
    setDB(d => ({ ...d, parties: d.parties.filter(x => x.id !== p.id) }));
    log(`Deleted party: ${p.name}`, "Party Master");
  };

  const exportCSV = () => {
    downloadCSV("parties.csv", [
      ["Name", "Type", "GST", "Contact", "Mobile", "Email", "Address", "City", "Payment Terms", "Credit Limit"],
      ...parties.map(p => [p.name, p.type, p.gst || "", p.contactPerson || "", p.mobile || "", p.email || "", p.address || "", p.city || "", p.paymentTerms || "", p.creditLimit || 0])
    ]);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Party Master</h1>
          <p className="text-sm text-slate-500">Customers, Vendors and Suppliers</p>
        </div>
        <div className="flex gap-2">
          {canExport && <Button variant="outline" onClick={exportCSV}><IconDownload size={14}/> Export</Button>}
          {canCreate && <Button onClick={openNew}><IconPlus size={14}/> New Party</Button>}
        </div>
      </div>

      <Card>
        <div className="p-4 flex flex-wrap gap-3 items-center border-b border-slate-100 dark:border-slate-800">
          <div className="relative flex-1 min-w-48">
            <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
            <Input className="pl-9" placeholder="Search name, GST, mobile..." value={search} onChange={(e: any) => setSearch(e.target.value)}/>
          </div>
          <Select value={type} onChange={(e: any) => setType(e.target.value)} className="w-40">
            <option value="all">All Types</option>
            {allowedTypes.includes("customer") && <option value="customer">Customers</option>}
            {allowedTypes.includes("vendor") && <option value="vendor">Vendors</option>}
            {allowedTypes.includes("supplier") && <option value="supplier">Suppliers</option>}
          </Select>
        </div>
        <Table>
          <thead>
            <tr><Th>Name</Th><Th>Type</Th><Th>GST</Th><Th>Contact</Th><Th>City</Th><Th>Mobile</Th><Th>Owner</Th><Th>Actions</Th></tr>
          </thead>
          <tbody>
            {parties.map(p => (
              <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <Td>
                  <button type="button" className="text-left" onClick={() => setHistoryParty(p)} data-testid={`party-history-${p.id}`}>
                    <div className="font-medium text-indigo-600 hover:underline">{p.name}</div>
                    <div className="text-xs text-slate-500">{p.email}</div>
                  </button>
                </Td>
                <Td><Badge color={p.type === "customer" ? "blue" : p.type === "vendor" ? "purple" : "indigo"}>{p.type}</Badge></Td>
                <Td className="font-mono text-xs">{p.gst}</Td>
                <Td>{p.contactPerson}</Td>
                <Td>{p.city || "—"}</Td>
                <Td>{p.mobile}</Td>
                <Td className="text-xs">{db.users.find(u => u.id === p.ownerId)?.name || "—"}</Td>
                <Td>
                  <div className="flex gap-1">
                    {canEdit && <Button size="sm" variant="ghost" onClick={() => openEdit(p)}><IconEdit size={14}/></Button>}
                    {canDelete && (isAdmin || p.ownerId === currentUser?.id) && <Button size="sm" variant="ghost" onClick={() => remove(p)}><IconTrash size={14}/></Button>}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {parties.length === 0 && <Empty title="No parties found" subtitle="Click 'New Party' to create one"/>}
      </Card>

      {historyParty && <PartyHistoryModal party={historyParty} onClose={() => setHistoryParty(null)} />}

      <Modal open={open} onClose={() => setOpen(false)} title={edit ? "Edit Party" : "New Party"} size="lg">
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2"><Label>Party Name *</Label><Input value={form.name} onChange={(e: any) => setForm({...form, name: e.target.value})}/></div>
          <div><Label>Type</Label>
            <Select value={form.type} onChange={(e: any) => setForm({...form, type: e.target.value})}>
              {allowedTypes.includes("customer") && <option value="customer">Customer</option>}
              {allowedTypes.includes("vendor") && <option value="vendor">Vendor</option>}
              {allowedTypes.includes("supplier") && <option value="supplier">Supplier</option>}
            </Select>
          </div>
          <div><Label>GST Number</Label><Input value={form.gst} onChange={(e: any) => setForm({...form, gst: e.target.value})}/></div>
          <div className="sm:col-span-2"><Label>Address</Label><Input value={form.address} onChange={(e: any) => setForm({...form, address: e.target.value})}/></div>
          <div><Label>City</Label><Input value={form.city || ""} onChange={(e: any) => setForm({...form, city: e.target.value})} placeholder="e.g. Jaipur" data-testid="party-city"/></div>
          <div><Label>Contact Person</Label><Input value={form.contactPerson} onChange={(e: any) => setForm({...form, contactPerson: e.target.value})}/></div>
          <div><Label>Mobile Number</Label><Input value={form.mobile} onChange={(e: any) => setForm({...form, mobile: e.target.value})}/></div>
          <div><Label>Email</Label><Input value={form.email} onChange={(e: any) => setForm({...form, email: e.target.value})}/></div>
          <div><Label>Payment Terms</Label><Input value={form.paymentTerms} onChange={(e: any) => setForm({...form, paymentTerms: e.target.value})}/></div>
          <div><Label>Credit Limit (₹)</Label><Input type="number" value={form.creditLimit} onChange={(e: any) => setForm({...form, creditLimit: Number(e.target.value)})}/></div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={save}>{edit ? "Update" : "Create"}</Button>
        </div>
      </Modal>
    </div>
  );
}
