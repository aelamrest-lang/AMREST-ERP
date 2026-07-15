import { useMemo, useState } from "react";
import { useStore, uid } from "../lib/store";
import { Card, Button, Input, Select, Label, Modal, Table, Th, Td, Badge, Empty, Textarea } from "../components/ui";
import { IconPlus, IconSearch, IconCheck } from "../components/icons";
import { todayISO } from "../lib/utils";
import { userCan } from "../lib/permissions";
import type { Lead } from "../lib/types";

const STAGES = ["Inquiry", "Quotation Sent", "Negotiation", "Order Confirmed", "Production", "Delivered"] as const;
type Stage = typeof STAGES[number];

function normalizeStage(status: Lead["status"]): Stage {
  if (status === "New" || status === "Followup") return "Inquiry";
  if (status === "Quoted") return "Quotation Sent";
  if (status === "Converted") return "Order Confirmed";
  if (status === "Lost") return "Negotiation";
  return status as Stage;
}

export function Leads() {
  const { db, setDB, currentUser, log } = useStore();
  const isAdmin = currentUser?.role === "admin";
  const canCreate = userCan(currentUser, "leads", "create");
  const canEdit = userCan(currentUser, "leads", "edit");
  const [open, setOpen] = useState(false);
  const [timeline, setTimeline] = useState<Lead | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | Stage>("all");

  const leads = db.leads || [];
  const visibleLeads = useMemo(() => {
    const base = isAdmin ? leads : leads.filter(l => l.ownerId === currentUser?.id);
    return base.filter(l => {
      const text = `${l.customerName} ${l.contactPerson || ""} ${l.contact} ${l.email || ""} ${l.product} ${l.notes}`.toLowerCase();
      const stage = normalizeStage(l.status);
      return (!search || text.includes(search.toLowerCase())) && (status === "all" || stage === status);
    });
  }, [leads, isAdmin, currentUser, search, status]);

  const blank = (): Lead => ({
    id: "",
    date: todayISO(),
    customerName: "",
    contactPerson: "",
    contact: "",
    email: "",
    product: "Transformer requirement",
    notes: "",
    status: "Inquiry",
    ownerId: currentUser!.id,
    followups: [],
  });
  const [form, setForm] = useState<Lead>(blank());

  const openNew = () => { setForm(blank()); setOpen(true); };
  const save = () => {
    if (!form.customerName) return alert("Client / Company is required");
    const entry = form.id ? form : { ...form, id: uid(), followups: [{ date: todayISO(), note: "Customer lead created" }] };
    setDB(d => ({ ...d, leads: form.id ? leads.map(l => l.id === form.id ? entry : l) : [entry, ...leads] }));
    log(`${form.id ? "Updated" : "Created"} sales lead: ${form.customerName}`, "Sales CRM");
    setOpen(false);
  };

  const setLeadStage = (lead: Lead, stage: Stage) => {
    const updated = { ...lead, status: stage, followups: [{ date: todayISO(), note: `Stage changed to ${stage}` }, ...(lead.followups || [])] };
    setDB(d => ({ ...d, leads: leads.map(l => l.id === lead.id ? updated : l) }));
    log(`Lead ${lead.customerName} moved to ${stage}`, "Sales CRM");
  };

  const stageColor = (stage: Stage) => stage === "Inquiry" ? "blue" : stage === "Quotation Sent" ? "yellow" : stage === "Negotiation" ? "purple" : stage === "Order Confirmed" ? "green" : stage === "Production" ? "indigo" : "green";

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Sales CRM & Leads</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">System-wide active customer inquiries and leads</p>
          </div>
          {canCreate && <Button onClick={openNew} size="lg"><IconPlus size={16}/> Add Customer Lead</Button>}
        </div>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        {STAGES.map(stage => (
          <Card key={stage} className="p-4 text-center">
            <div className="text-sm font-semibold text-slate-500 dark:text-slate-400">{stage}</div>
            <div className="text-2xl font-bold mt-2 text-slate-900 dark:text-slate-100">{visibleLeads.filter(l => normalizeStage(l.status) === stage).length}</div>
          </Card>
        ))}
      </div>

      <Card>
        <div className="p-4 flex items-center gap-3 flex-wrap border-b border-slate-100 dark:border-slate-800">
          <div className="relative flex-1 min-w-64">
            <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input className="pl-9" value={search} onChange={(e: any) => setSearch(e.target.value)} placeholder="Search by client name, contact, requirement..." />
          </div>
          <Select className="w-52" value={status} onChange={(e: any) => setStatus(e.target.value)}>
            <option value="all">All Statuses</option>
            {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
          </Select>
        </div>
        <Table>
          <thead><tr><Th>Client / Company</Th><Th>Contact Person</Th><Th>Requirement</Th><Th>Created Date</Th><Th>Owner</Th><Th>Stage Status</Th><Th>Action</Th></tr></thead>
          <tbody>
            {visibleLeads.map(lead => {
              const owner = db.users.find(u => u.id === lead.ownerId);
              const stage = normalizeStage(lead.status);
              return (
                <tr key={lead.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <Td className="font-semibold text-slate-900 dark:text-slate-100">{lead.customerName}</Td>
                  <Td><div className="font-medium">{lead.contactPerson || "-"}</div><div className="text-xs text-slate-500">{lead.contact}{lead.email ? ` | ${lead.email}` : ""}</div></Td>
                  <Td className="max-w-md truncate">{lead.product || lead.notes}</Td>
                  <Td>{lead.date}</Td>
                  <Td><Badge color="slate">{owner?.name || "-"}</Badge></Td>
                  <Td>
                    {canEdit ? <Select className="text-xs py-1" value={stage} onChange={(e: any) => setLeadStage(lead, e.target.value)}>{STAGES.map(s => <option key={s} value={s}>{s}</option>)}</Select> : <Badge color={stageColor(stage)}>{stage}</Badge>}
                  </Td>
                  <Td><Button size="sm" variant="ghost" onClick={() => setTimeline(lead)}>View Timeline ({lead.followups?.length || 0})</Button></Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        {visibleLeads.length === 0 && <Empty title="No sales leads found" subtitle="Add a customer lead to begin tracking the CRM pipeline" />}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="Add Customer Lead" size="lg">
        <div className="grid sm:grid-cols-2 gap-3">
          <div><Label>Created Date</Label><Input type="date" value={form.date} onChange={(e: any) => setForm({...form, date: e.target.value})}/></div>
          <div><Label>Stage</Label><Select value={normalizeStage(form.status)} onChange={(e: any) => setForm({...form, status: e.target.value})}>{STAGES.map(s => <option key={s}>{s}</option>)}</Select></div>
          <div className="sm:col-span-2"><Label>Client / Company *</Label><Input value={form.customerName} onChange={(e: any) => setForm({...form, customerName: e.target.value})}/></div>
          <div><Label>Contact Person</Label><Input value={form.contactPerson || ""} onChange={(e: any) => setForm({...form, contactPerson: e.target.value})}/></div>
          <div><Label>Mobile Number</Label><Input value={form.contact} onChange={(e: any) => setForm({...form, contact: e.target.value})}/></div>
          <div><Label>Email</Label><Input value={form.email || ""} onChange={(e: any) => setForm({...form, email: e.target.value})}/></div>
          <div><Label>Owner</Label><Select value={form.ownerId} onChange={(e: any) => setForm({...form, ownerId: e.target.value})}>{db.users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></div>
          <div className="sm:col-span-2"><Label>Requirement</Label><Textarea rows={3} value={form.product} onChange={(e: any) => setForm({...form, product: e.target.value})}/></div>
          <div className="sm:col-span-2"><Label>Notes</Label><Textarea rows={2} value={form.notes} onChange={(e: any) => setForm({...form, notes: e.target.value})}/></div>
        </div>
        <div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save}><IconCheck size={14}/> Save Lead</Button></div>
      </Modal>

      <Modal open={!!timeline} onClose={() => setTimeline(null)} title={`Timeline: ${timeline?.customerName || ""}`} size="md">
        <div className="space-y-3">
          {(timeline?.followups || []).length === 0 && <Empty title="No timeline entries" />}
          {(timeline?.followups || []).map((f, i) => <div key={i} className="border-l-2 border-indigo-500 pl-3 py-1"><div className="text-xs text-slate-500">{f.date}</div><div className="text-sm font-medium text-slate-800 dark:text-slate-100">{f.note}</div></div>)}
        </div>
      </Modal>
    </div>
  );
}