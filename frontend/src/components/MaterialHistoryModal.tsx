import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { useStore } from "../lib/store";
import type { Item } from "../lib/types";
import { Modal, Table, Th, Td, Badge, Empty, Input, Button } from "./ui";
import { IconDownload } from "./icons";
import { fmt2, fmtINR } from "../lib/utils";

type Txn = {
  key: string; dir: "IN" | "OUT"; date: string; at: string; qty: number; balance: number;
  poNo?: string; grnNo?: string; party?: string; rate?: number; amount?: number; receivedBy?: string;
  issueNo?: string; jcNo?: string; issuedTo?: string; issuedBy?: string; adj?: boolean;
};
type Tab = "in" | "out" | "all";
const round = (n: number) => Math.round(n * 1000) / 1000;

const go = (route: string) => { (window as any).__amrestSetRoute?.(route); setTimeout(() => window.scrollTo(0, 0), 50); };

function RefLink({ label, route, testId }: { label?: string; route: string; testId: string }) {
  if (!label) return <span className="text-slate-400">—</span>;
  return <button type="button" className="font-mono text-xs text-left text-indigo-600 hover:underline" onClick={() => go(route)} data-testid={testId}>{label}</button>;
}

function useItemTxns(item: Item | null): Txn[] {
  const { db } = useStore();
  return useMemo(() => {
    if (!item) return [];
    const list: Omit<Txn, "balance">[] = [];
    db.grns.forEach(g => g.receivedItems.forEach((r, idx) => {
      if (r.itemId !== item.id || !r.qty) return;
      const po = db.purchaseOrders.find(p => p.id === g.poId);
      const rate = Number(po?.items.find(x => x.itemId === item.id)?.rate) || 0;
      const created = (db.grnAudit || []).find(a => a.grnNumber === g.number && a.action === "Created");
      list.push({ key: `g-${g.id}-${idx}`, dir: "IN", date: g.date || "", at: g.createdAt || "", qty: r.qty,
        poNo: po?.number, grnNo: g.number, party: db.parties.find(p => p.id === po?.vendorId)?.name,
        rate, amount: rate * r.qty, receivedBy: created?.byName || po?.createdByName });
    }));
    db.materialIssues.forEach(mi => mi.lines.forEach((l, idx) => {
      if (l.itemId !== item.id || !(l.issueQty > 0)) return;
      list.push({ key: `i-${mi.id}-${idx}`, dir: "OUT", date: mi.date, at: mi.createdAt || "", qty: l.issueQty,
        issueNo: mi.number, jcNo: mi.jobCardNumber, issuedTo: mi.issuedTo,
        issuedBy: db.users.find(u => u.id === mi.issueBy)?.name || mi.issueBy });
    }));
    list.sort((a, b) => a.date.localeCompare(b.date) || a.at.localeCompare(b.at));
    let bal = Number(item.openingStock) || 0;
    const rows: Txn[] = list.map(t => { bal += t.dir === "IN" ? t.qty : -t.qty; return { ...t, balance: round(bal) }; });
    const gap = round((Number(item.currentStock) || 0) - bal);
    if (gap !== 0) rows.push({ key: "adj", dir: gap > 0 ? "IN" : "OUT", adj: true, date: "", at: "", qty: Math.abs(gap), balance: round(Number(item.currentStock) || 0) });
    return rows.reverse();
  }, [item, db.grns, db.purchaseOrders, db.materialIssues, db.parties, db.users, db.grnAudit]);
}

function exportXlsx(item: Item, all: Txn[], tab: Tab) {
  const rows = all.filter(t => !t.adj);
  const data = rows.map(t => tab === "in"
    ? { Date: t.date, "PO Number": t.poNo || "", "GRN Number": t.grnNo || "", Supplier: t.party || "", "Received Qty": round(t.qty), "Purchase Rate": t.rate || 0, "Total Amount": round(t.amount || 0), "Received By": t.receivedBy || "", "Running Balance": t.balance }
    : tab === "out"
      ? { "Issue Date": t.date, "Issue No": t.issueNo || "", "Job Card": t.jcNo || "", "Issued Qty": t.qty, "Issued To": t.issuedTo || "", "Issued By": t.issuedBy || "", "Running Balance": t.balance }
      : { Date: t.date, Type: t.dir === "IN" ? "Stock In" : "Stock Out", Reference: t.dir === "IN" ? `${t.poNo || ""} / ${t.grnNo || ""}` : `${t.issueNo || ""} / ${t.jcNo || ""}`, "Party / Issued To": t.dir === "IN" ? t.party || "" : t.issuedTo || "", "Qty In": t.dir === "IN" ? t.qty : "", "Qty Out": t.dir === "OUT" ? t.qty : "", Rate: t.rate ?? "", Amount: t.amount ?? "", By: t.dir === "IN" ? t.receivedBy || "" : t.issuedBy || "", "Running Balance": t.balance });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), tab === "in" ? "Stock In" : tab === "out" ? "Stock Out" : "All Transactions");
  XLSX.writeFile(wb, `${item.name.replace(/[^a-z0-9]+/gi, "_")}_history_${tab}.xlsx`);
}

function TxnTable({ rows, tab, unit }: { rows: Txn[]; tab: Tab; unit: string }) {
  if (!rows.length) return <Empty title="No transactions found" subtitle="Try changing the date filter" />;
  return (
    <Table>
      <thead><tr>
        {tab === "in" && <><Th>Date</Th><Th>PO Number</Th><Th>GRN Number</Th><Th>Supplier / Party</Th><Th>Received Qty</Th><Th>Purchase Rate</Th><Th>Total Amount</Th><Th>Received By</Th></>}
        {tab === "out" && <><Th>Issue Date</Th><Th>Issue No</Th><Th>Job Card</Th><Th>Issued Qty</Th><Th>Issued To</Th><Th>Issued By</Th></>}
        {tab === "all" && <><Th>Date</Th><Th>Type</Th><Th>Reference</Th><Th>Party / Issued To</Th><Th>Qty In</Th><Th>Qty Out</Th><Th>Rate</Th><Th>By</Th></>}
        <Th>Running Balance</Th>
      </tr></thead>
      <tbody>
        {rows.map(t => t.adj ? (
          <tr key={t.key} className="bg-amber-50 dark:bg-amber-950/20" data-testid="mh-row-adj">
            <Td colSpan={tab === "in" ? 8 : tab === "out" ? 6 : 8} className="text-xs text-amber-800 dark:text-amber-300">
              <b>Other stock adjustments {t.dir === "IN" ? "+" : "−"}{fmt2(t.qty)} {unit}</b> · manual stock edits, Excel uploads or movements outside GRN / Material Issue — brings the balance to current stock
            </Td>
            <Td className="font-semibold" data-testid="mh-bal-adj">{fmt2(t.balance)} {unit}</Td>
          </tr>
        ) : (
          <tr key={t.key} className="hover:bg-slate-50 dark:hover:bg-slate-800/50" data-testid={`mh-row-${t.key}`}>
            {tab === "in" && <><Td>{t.date}</Td><Td><RefLink label={t.poNo} route="purchase" testId={`mh-po-${t.key}`}/></Td><Td><RefLink label={t.grnNo} route="grn" testId={`mh-grn-${t.key}`}/></Td><Td>{t.party || "—"}</Td><Td className="text-emerald-600 font-semibold">{fmt2(t.qty)} {unit}</Td><Td>{fmtINR(t.rate || 0)}</Td><Td>{fmtINR(t.amount || 0)}</Td><Td>{t.receivedBy || "—"}</Td></>}
            {tab === "out" && <><Td>{t.date}</Td><Td className="font-mono text-xs">{t.issueNo}</Td><Td><RefLink label={t.jcNo} route="jobcards" testId={`mh-jc-${t.key}`}/></Td><Td className="text-rose-600 font-semibold">{fmt2(t.qty)} {unit}</Td><Td>{t.issuedTo || "—"}</Td><Td>{t.issuedBy || "—"}</Td></>}
            {tab === "all" && <>
              <Td>{t.date}</Td>
              <Td><Badge color={t.dir === "IN" ? "green" : "red"}>{t.dir === "IN" ? "Stock In" : "Stock Out"}</Badge></Td>
              <Td>{t.dir === "IN"
                ? <div className="flex flex-col"><RefLink label={t.poNo} route="purchase" testId={`mh-po-${t.key}`}/><RefLink label={t.grnNo} route="grn" testId={`mh-grn-${t.key}`}/></div>
                : <div className="flex flex-col"><span className="font-mono text-xs">{t.issueNo}</span><RefLink label={t.jcNo} route="jobcards" testId={`mh-jc-${t.key}`}/></div>}</Td>
              <Td>{t.dir === "IN" ? t.party || "—" : t.issuedTo || "—"}</Td>
              <Td className="text-emerald-600">{t.dir === "IN" ? fmt2(t.qty) : ""}</Td>
              <Td className="text-rose-600">{t.dir === "OUT" ? fmt2(t.qty) : ""}</Td>
              <Td>{t.dir === "IN" ? fmtINR(t.rate || 0) : ""}</Td>
              <Td>{(t.dir === "IN" ? t.receivedBy : t.issuedBy) || "—"}</Td>
            </>}
            <Td className="font-semibold" data-testid={`mh-bal-${t.key}`}>{fmt2(t.balance)} {unit}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export function MaterialHistoryModal({ item, onClose }: { item: Item | null; onClose: () => void }) {
  const txns = useItemTxns(item);
  const [tab, setTab] = useState<Tab>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const rows = useMemo(() => txns.filter(t => (tab === "all" || (tab === "in" ? t.dir === "IN" : t.dir === "OUT")) && (t.adj ? tab === "all" && !from && !to : (!from || t.date >= from) && (!to || t.date <= to))), [txns, tab, from, to]);
  if (!item) return null;
  const real = rows.filter(t => !t.adj);
  const totIn = real.filter(t => t.dir === "IN").reduce((s, t) => s + t.qty, 0);
  const totOut = real.filter(t => t.dir === "OUT").reduce((s, t) => s + t.qty, 0);
  return (
    <Modal open={!!item} onClose={onClose} title={`Stock History · ${item.name}`} size="xl">
      <div className="space-y-4" data-testid="material-history-modal">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3"><div className="text-xs text-slate-500">Live Current Stock (today)</div><div className="text-lg font-bold" data-testid="mh-current-stock">{fmt2(item.currentStock)} {item.unit}</div></div>
          <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 p-3"><div className="text-xs text-slate-500">Stock In (shown)</div><div className="text-lg font-bold text-emerald-600" data-testid="mh-total-in">{fmt2(totIn)}</div></div>
          <div className="rounded-lg border border-rose-200 dark:border-rose-900 p-3"><div className="text-xs text-slate-500">Stock Out (shown)</div><div className="text-lg font-bold text-rose-600" data-testid="mh-total-out">{fmt2(totOut)}</div></div>
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3"><div className="text-xs text-slate-500">Transactions</div><div className="text-lg font-bold" data-testid="mh-count">{real.length}</div></div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {([["in", "Stock In"], ["out", "Stock Out"], ["all", "All Transactions"]] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setTab(k)} data-testid={`mh-tab-${k}`}
              className={"text-xs px-3 py-1.5 rounded-full border font-medium " + (tab === k ? "bg-indigo-600 border-indigo-600 text-white" : "border-slate-300 dark:border-slate-700 text-slate-600 hover:border-indigo-400")}>{l}</button>
          ))}
          <div className="flex flex-wrap items-center gap-2 md:ml-auto w-full md:w-auto">
            <Input type="date" className="!w-36 sm:!w-40" value={from} onChange={(e: any) => setFrom(e.target.value)} data-testid="mh-from"/>
            <span className="text-xs text-slate-400">to</span>
            <Input type="date" className="!w-36 sm:!w-40" value={to} onChange={(e: any) => setTo(e.target.value)} data-testid="mh-to"/>
            {(from || to) && <button type="button" className="text-xs text-indigo-600 hover:underline" onClick={() => { setFrom(""); setTo(""); }} data-testid="mh-clear-dates">Clear</button>}
            <Button variant="outline" onClick={() => exportXlsx(item, rows, tab)} data-testid="mh-export"><IconDownload size={14}/> Excel</Button>
          </div>
        </div>
        <p className="text-[11px] text-slate-500">Read-only view built from saved GRN and Raw Material Issue records. Running balance starts from the item&apos;s opening stock; any difference to current stock is shown as an adjustment row.</p>
        <div className="max-h-[55vh] overflow-auto"><TxnTable rows={rows} tab={tab} unit={item.unit} /></div>
      </div>
    </Modal>
  );
}
