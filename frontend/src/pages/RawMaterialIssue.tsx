import { useMemo, useState } from "react";
import { useStore, uid } from "../lib/store";
import { Badge, Button, Card, Empty, Input, KPI, Label, Select, Table, Td, Th } from "../components/ui";
import type { JobCard, MaterialIssue, MaterialIssueLine } from "../lib/types";
import { IconBox, IconCheck, IconDownload, IconFile, IconPrint, IconSearch } from "../components/icons";
import { downloadCSV, nextNumber, printArea, professionalDocument, todayISO } from "../lib/utils";
import { userCan } from "../lib/permissions";

const STORES = ["Main Store", "Copper Store", "Core Store", "Oil Store", "Finished Goods Store"];

export function RawMaterialIssue() {
  const { db, setDB, currentUser, log } = useStore();
  const canCreate = userCan(currentUser, "rawissue", "create");
  const canPrint = userCan(currentUser, "rawissue", "print");
  const canExport = userCan(currentUser, "rawissue", "export");
  const [jobId, setJobId] = useState(db.jobCards[0]?.id || "");
  const [storeLocation, setStoreLocation] = useState(STORES[0]);
  const [remarks, setRemarks] = useState("");
  const [issueQty, setIssueQty] = useState<Record<string, number>>({});
  const [warning, setWarning] = useState("");
  const [filters, setFilters] = useState({ search: "", store: "", date: "", status: "" });

  const job = db.jobCards.find(j => j.id === jobId) || db.jobCards[0];

  const issueRows = useMemo(() => buildRows(job, db.materialIssues, db.items, db.jobCards), [job, db.materialIssues, db.items, db.jobCards]);
  const outOfStockRows = issueRows.filter(r => r.pendingQty > 0 && r.currentStock <= 0);
  const lowStockRows = issueRows.filter(r => r.currentStock > 0 && r.currentStock <= (db.items.find(i => i.id === r.itemId)?.minStock || 0));

  const pendingCount = issueRows.filter(r => r.status === "Pending").length;
  const partialCount = issueRows.filter(r => r.status === "Partial Issued").length;
  const fullCount = issueRows.filter(r => r.status === "Fully Issued").length;

  const filteredIssues = useMemo(() => db.materialIssues.filter(issue => {
    const text = `${issue.jobCardNumber} ${issue.productName} ${issue.storeLocation} ${issue.lines.map(l => db.items.find(i => i.id === l.itemId)?.name).join(" ")}`.toLowerCase();
    return (!filters.search || text.includes(filters.search.toLowerCase()))
      && (!filters.store || issue.storeLocation === filters.store)
      && (!filters.date || issue.date === filters.date)
      && (!filters.status || issue.lines.some(l => l.status === filters.status));
  }), [db.materialIssues, db.items, filters]);

  const setQty = (itemId: string, value: number) => {
    const row = issueRows.find(r => r.itemId === itemId);
    if (!row) return;
    const maxAllowed = Math.min(row.pendingQty, Math.max(0, row.currentStock));
    if (value > row.pendingQty) {
      setIssueQty(prev => ({ ...prev, [itemId]: row.pendingQty }));
      setWarning("Issue quantity exceeds pending quantity");
      return;
    }
    if (value > row.currentStock) {
      setIssueQty(prev => ({ ...prev, [itemId]: maxAllowed }));
      setWarning("Issue quantity exceeds available stock");
      return;
    }
    setIssueQty(prev => ({ ...prev, [itemId]: Math.max(0, value) }));
    setWarning("");
  };

  const fillMaxAvailable = () => {
    const next: Record<string, number> = {};
    issueRows.forEach(r => { next[r.itemId] = Math.min(r.pendingQty, Math.max(0, r.currentStock)); });
    setIssueQty(next);
  };

  const saveIssue = () => {
    if (!job) return alert("Select a Job Card first.");
    if (!canCreate) return alert("Permission denied.");
    const lines = issueRows
      .map(row => ({ ...row, issueQty: Number(issueQty[row.itemId] || 0), status: statusAfter(row, Number(issueQty[row.itemId] || 0)) }))
      .filter(row => row.issueQty > 0);
    if (!lines.length) return alert("Enter at least one issue quantity.");
    const invalid = lines.find(line => line.issueQty > line.pendingQty || line.issueQty > line.currentStock);
    if (invalid) return setWarning(invalid.issueQty > invalid.pendingQty ? "Issue quantity exceeds pending quantity" : "Issue quantity exceeds available stock");

    const issue: MaterialIssue = {
      id: uid(), number: nextNumber("MIS", db.materialIssues), date: todayISO(), jobCardId: job.id,
      jobCardNumber: job.number, productName: job.product, bomId: job.bomId, storeLocation,
      issueBy: currentUser?.id || "", remarks, lines, createdAt: new Date().toISOString(),
    };

    setDB(d => ({
      ...d,
      materialIssues: [issue, ...d.materialIssues],
      // Issuing immediately deducts from central Current Stock (same value shown in Item Master & Inventory)
      items: d.items.map(it => {
        const qty = issue.lines.filter(l => l.itemId === it.id).reduce((s, l) => s + (l.issueQty || 0), 0);
        return qty > 0 ? { ...it, currentStock: Math.max(0, (it.currentStock || 0) - qty) } : it;
      }),
    }));
    log(`Material Issue ${issue.number} saved for ${job.number}`, "Raw Material Issue");
    setIssueQty({}); setRemarks(""); setWarning("");
    printIssue(issue);
  };

  const printIssue = (issue: MaterialIssue) => {
    const body = `<div class="box"><div class="section-title">Issue Against Job Card</div><b>Job Card:</b> ${issue.jobCardNumber}<br/><b>Product:</b> ${issue.productName}<br/><b>Store:</b> ${issue.storeLocation}<br/><b>Issue By:</b> ${db.users.find(u => u.id === issue.issueBy)?.name || "-"}<br/><b>Remarks:</b> ${issue.remarks || "-"}</div><table><thead><tr><th>#</th><th>Material</th><th class="right">Required</th><th class="right">Already Issued</th><th class="right">Qty Issued</th><th class="right">Balance</th><th>UOM</th></tr></thead><tbody>${issue.lines.map((line, idx) => { const item = db.items.find(i => i.id === line.itemId); return `<tr><td>${idx + 1}</td><td>${item?.name || "-"}</td><td class="right">${line.requiredQty}</td><td class="right">${line.alreadyIssuedQty}</td><td class="right">${line.issueQty}</td><td class="right">${Math.max(0, line.pendingQty - line.issueQty)}</td><td>${line.unit}</td></tr>`; }).join("")}</tbody></table><div class="signs"><div class="sign-box">Store Keeper</div><div class="sign-box">Production Receiver</div><div class="sign-box">Approved By</div></div>`;
    printArea(professionalDocument(db.settings, { title: "Material Issue Slip", number: issue.number, date: issue.date, body, accent: "#2563eb" }), issue.number);
  };

  const exportRows = () => downloadCSV("material-issue-report.csv", [["Date", "Issue No", "Job Card", "Product", "Store", "Material", "Required", "Issued", "Status"], ...db.materialIssues.flatMap(issue => issue.lines.map(line => [issue.date, issue.number, issue.jobCardNumber, issue.productName, issue.storeLocation, db.items.find(i => i.id === line.itemId)?.name || "", line.requiredQty, line.issueQty, line.status]))]);

  return <div className="space-y-5">
    <div className="flex items-center justify-between gap-3 flex-wrap"><div><h1 className="text-2xl font-bold">Raw Material Issue</h1><p className="text-sm text-slate-500">Issue raw materials against Job Card with partial issue and stock controls.</p></div><div className="flex gap-2">{canPrint && filteredIssues[0] && <Button variant="outline" onClick={() => printIssue(filteredIssues[0])}><IconPrint size={14}/> PDF</Button>}{canExport && <Button variant="outline" onClick={exportRows}><IconDownload size={14}/> Excel</Button>}</div></div>

    <div className="grid grid-cols-2 md:grid-cols-5 gap-4"><KPI label="Pending Material Issue" value={String(pendingCount)} color="amber" icon={<IconFile size={22}/>}/><KPI label="Partial Issue" value={String(partialCount)} color="indigo" icon={<IconBox size={22}/>}/><KPI label="Fully Issued" value={String(fullCount)} color="emerald" icon={<IconCheck size={22}/>}/><KPI label="Out Of Stock" value={String(outOfStockRows.length)} color="rose" icon={<IconBox size={22}/>}/><KPI label="Low Stock" value={String(lowStockRows.length)} color="amber" icon={<IconBox size={22}/>}/></div>

    {outOfStockRows.length > 0 && <Card className="border-rose-300 dark:border-rose-800"><div className="p-4 bg-rose-50 dark:bg-rose-950/30 border-b border-rose-200 dark:border-rose-900"><h3 className="font-semibold text-rose-700 dark:text-rose-300">Out Of Stock Materials</h3></div><Table><thead><tr><Th>Material</Th><Th>Required Qty</Th><Th>Available Stock</Th><Th>Shortage Qty</Th></tr></thead><tbody>{outOfStockRows.map(row => { const item = db.items.find(i => i.id === row.itemId); return <tr key={row.itemId}><Td className="font-medium">{item?.name}</Td><Td>{row.pendingQty} {row.unit}</Td><Td className="text-rose-600 font-semibold">{row.currentStock} {row.unit}</Td><Td className="text-rose-600 font-semibold">{Math.max(0, row.pendingQty - row.currentStock)} {row.unit}</Td></tr>; })}</tbody></Table></Card>}
    {lowStockRows.length > 0 && <Card className="border-amber-300 dark:border-amber-800"><div className="p-3 text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30">Low Stock Warning: Some materials are below minimum stock level.</div></Card>}

    <Card><div className="p-4 grid md:grid-cols-4 gap-3 border-b border-slate-100 dark:border-slate-800"><div><Label>Date</Label><Input value={todayISO()} disabled /></div><div><Label>Job Card Number</Label><Select value={job?.id || ""} onChange={(e: any) => { setJobId(e.target.value); setIssueQty({}); }}><option value="">Select Job Card</option>{db.jobCards.map(j => <option key={j.id} value={j.id}>{j.number}</option>)}</Select></div><div><Label>Product Name</Label><Input value={job?.product || ""} disabled /></div><div><Label>BOM Number</Label><Input value={job?.bomId ? db.boms.find(b => b.id === job.bomId)?.name || job.bomId : "-"} disabled /></div><div><Label>Store Location</Label><Select value={storeLocation} onChange={(e: any) => setStoreLocation(e.target.value)}>{STORES.map(store => <option key={store}>{store}</option>)}</Select></div><div><Label>Issue By</Label><Input value={currentUser?.name || ""} disabled /></div><div className="md:col-span-2"><Label>Remarks</Label><Input value={remarks} onChange={(e: any) => setRemarks(e.target.value)} /></div></div>{warning && <div className="mx-4 mt-3 rounded-lg bg-rose-50 text-rose-700 px-3 py-2 text-sm">{warning}</div>}<div className="p-4 flex justify-between gap-2 flex-wrap"><div className="text-sm text-slate-500">Material issue only against selected Job Card. Partial issue is supported.</div><div className="flex gap-2"><Button variant="outline" onClick={fillMaxAvailable}>Fill Max Available</Button><Button variant="outline" onClick={() => setIssueQty({})}>Clear</Button><Button onClick={saveIssue}>Save Issue</Button></div></div><Table><thead><tr><Th>Material Name</Th><Th>Required Qty</Th><Th>Already Issued Qty</Th><Th>Pending Issue Qty</Th><Th>Current Stock</Th><Th>Today Issue Qty</Th><Th>Unit</Th><Th>Status</Th></tr></thead><tbody>{issueRows.map(row => { const item = db.items.find(i => i.id === row.itemId); const color = row.currentStock <= 0 ? "red" : row.currentStock <= (item?.minStock || 0) ? "yellow" : "green"; return <tr key={row.itemId}><Td className="font-medium">{item?.name}</Td><Td>{row.requiredQty}</Td><Td>{row.alreadyIssuedQty}</Td><Td className="font-semibold text-amber-600">{row.pendingQty}</Td><Td><Badge color={color}>{row.currentStock}</Badge></Td><Td><Input type="number" value={issueQty[row.itemId] || 0} max={Math.min(row.pendingQty, row.currentStock)} onChange={(e: any) => setQty(row.itemId, Number(e.target.value))}/></Td><Td>{row.unit}</Td><Td><Badge color={row.status === "Fully Issued" ? "green" : row.status === "Partial Issued" ? "yellow" : "slate"}>{row.status}</Badge></Td></tr>; })}</tbody></Table>{issueRows.length === 0 && <Empty title="No BOM materials found" subtitle="Select a Job Card with reserved BOM materials" />}</Card>

    <Card><div className="p-4 grid md:grid-cols-5 gap-3 border-b border-slate-100 dark:border-slate-800"><div className="relative md:col-span-2"><IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><Input className="pl-9" placeholder="Search job card, material, store..." value={filters.search} onChange={(e: any) => setFilters({...filters, search: e.target.value})}/></div><Select value={filters.store} onChange={(e: any) => setFilters({...filters, store: e.target.value})}><option value="">All Stores</option>{STORES.map(s => <option key={s}>{s}</option>)}</Select><Input type="date" value={filters.date} onChange={(e: any) => setFilters({...filters, date: e.target.value})}/><Select value={filters.status} onChange={(e: any) => setFilters({...filters, status: e.target.value})}><option value="">All Status</option><option>Pending</option><option>Partial Issued</option><option>Fully Issued</option></Select></div><Table><thead><tr><Th>Date</Th><Th>Issue No</Th><Th>Job Card</Th><Th>Product</Th><Th>Store</Th><Th>Lines</Th><Th>Issued Qty</Th></tr></thead><tbody>{filteredIssues.map(issue => <tr key={issue.id}><Td>{issue.date}</Td><Td className="font-mono text-xs">{issue.number}</Td><Td>{issue.jobCardNumber}</Td><Td>{issue.productName}</Td><Td>{issue.storeLocation}</Td><Td>{issue.lines.length}</Td><Td>{issue.lines.reduce((s, l) => s + l.issueQty, 0)}</Td></tr>)}</tbody></Table>{filteredIssues.length === 0 && <Empty title="No material issue history" />}</Card>
  </div>;
}

function buildRows(job: JobCard | undefined, issues: MaterialIssue[], items: any[], jobCards: JobCard[]): MaterialIssueLine[] {
  if (!job) return [];
  const heldByItem = new Map<string, number>();
  jobCards.filter(j => j.status !== "Completed").forEach(j => {
    j.reservedItems.forEach(r => {
      const issuedQty = issues
        .filter(issue => issue.jobCardId === j.id)
        .flatMap(issue => issue.lines)
        .filter(line => line.itemId === r.itemId)
        .reduce((sum, line) => sum + line.issueQty, 0);
      const pendingHold = Math.max(0, r.qty - issuedQty);
      heldByItem.set(r.itemId, (heldByItem.get(r.itemId) || 0) + pendingHold);
    });
  });

  return job.reservedItems.map(r => {
    const item = items.find(i => i.id === r.itemId);
    const alreadyIssuedQty = issues.filter(issue => issue.jobCardId === job.id).flatMap(issue => issue.lines).filter(line => line.itemId === r.itemId).reduce((sum, line) => sum + line.issueQty, 0);
    const pendingQty = Math.max(0, r.qty - alreadyIssuedQty);
    const status: MaterialIssueLine["status"] = pendingQty <= 0 ? "Fully Issued" : alreadyIssuedQty > 0 ? "Partial Issued" : "Pending";
    const inventoryCurrentStock = item?.currentStock || 0; // physical stock — holds don't reduce it; issuing deducts it
    return { itemId: r.itemId, requiredQty: r.qty, alreadyIssuedQty, pendingQty, currentStock: inventoryCurrentStock, issueQty: 0, unit: item?.unit || "", status };
  });
}

function statusAfter(row: MaterialIssueLine, issueQty: number): MaterialIssueLine["status"] {
  const totalIssued = row.alreadyIssuedQty + issueQty;
  if (totalIssued >= row.requiredQty) return "Fully Issued";
  if (totalIssued > 0) return "Partial Issued";
  return "Pending";
}