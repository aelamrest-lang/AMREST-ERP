import { useState, useMemo } from "react";
import { useStore, uid } from "../lib/store";
import { Card, Button, Input, Select, Label, Modal, Table, Th, Td, Badge, Empty } from "../components/ui";
import type { Party } from "../lib/types";
import { IconPlus, IconEdit, IconTrash, IconSearch, IconDownload } from "../components/icons";
import { downloadCSV } from "../lib/utils";
import { userCan } from "../lib/permissions";

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

  const parties = useMemo(() => {
    let p = isAdmin ? db.parties : db.parties.filter(x => x.ownerId === currentUser?.id);
    p = p.filter(x => allowedTypes.includes(x.type));
    if (type !== "all") p = p.filter(x => x.type === type);
    if (search) {
      const s = search.toLowerCase();
      p = p.filter(x => x.name.toLowerCase().includes(s) || (x.gst || "").toLowerCase().includes(s) || (x.mobile || "").includes(s));
    }
    return p;
  }, [db.parties, isAdmin, currentUser, allowedTypes, type, search]);

  const blank: Party = { id: "", name: "", type: allowedTypes[0], gst: "", address: "", contactPerson: "", mobile: "", email: "", paymentTerms: "30 days", creditLimit: 0, ownerId: currentUser!.id, createdAt: new Date().toISOString() };
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
      ["Name", "Type", "GST", "Contact", "Mobile", "Email", "Address", "Payment Terms", "Credit Limit"],
      ...parties.map(p => [p.name, p.type, p.gst || "", p.contactPerson || "", p.mobile || "", p.email || "", p.address || "", p.paymentTerms || "", p.creditLimit || 0])
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
            <tr><Th>Name</Th><Th>Type</Th><Th>GST</Th><Th>Contact</Th><Th>Mobile</Th><Th>Owner</Th><Th>Actions</Th></tr>
          </thead>
          <tbody>
            {parties.map(p => (
              <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <Td><div className="font-medium">{p.name}</div><div className="text-xs text-slate-500">{p.email}</div></Td>
                <Td><Badge color={p.type === "customer" ? "blue" : p.type === "vendor" ? "purple" : "indigo"}>{p.type}</Badge></Td>
                <Td className="font-mono text-xs">{p.gst}</Td>
                <Td>{p.contactPerson}</Td>
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
