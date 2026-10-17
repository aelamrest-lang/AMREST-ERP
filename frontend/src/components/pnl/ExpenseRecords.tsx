import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { useStore, uid } from "../../lib/store";
import { Button, Input, Modal, Table, Th, Td, Badge, Empty } from "../ui";
import { fmtINR, downloadCSV } from "../../lib/utils";

export type ExpKind = "direct" | "indirect";
export interface ExpenseRecord { id: string; type: ExpKind; date: string; category: string; description: string; amount: number; createdAt: string }
type Draft = Omit<ExpenseRecord, "id" | "createdAt"> & { key: number };

export const expenseRecords = (settings: any): ExpenseRecord[] => settings.pnlExpenseRecords || [];
export const expKey = (r: { type: string; date: string; category: string; description: string; amount: number }) =>
  `${r.type}|${r.date}|${r.category.trim().toLowerCase()}|${r.description.trim().toLowerCase()}|${Number(r.amount).toFixed(2)}`;
const LABEL: Record<ExpKind, string> = { direct: "Direct Expenses", indirect: "Indirect Expenses" };
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function parseDate(raw: any): string {
  if (raw instanceof Date && !isNaN(raw.getTime())) return iso(new Date(raw.getTime() + 12 * 3600 * 1000));
  if (typeof raw === "number" && raw > 20000 && raw < 80000) { const d = new Date(Math.round((raw - 25569) * 86400000)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`; }
  const s = String(raw || "").trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const d = new Date(s);
  return s && !isNaN(d.getTime()) ? iso(d) : "";
}
const pick = (row: Record<string, any>, names: string[]) => {
  const norm = Object.fromEntries(Object.entries(row).map(([k, v]) => [k.trim().toLowerCase().replace(/[^a-z0-9]/g, ""), v]));
  for (const n of names) { const k = n.toLowerCase().replace(/[^a-z0-9]/g, ""); if (k in norm) return norm[k]; }
  return undefined;
};

export async function parseExpenseFile(file: File, type: ExpKind): Promise<Draft[]> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets[wb.SheetNames[0]], { defval: "" });
  return rows.map((r, i) => ({
    key: i, type, date: parseDate(pick(r, ["Date", "Expense Date", "Bill Date"])),
    category: String(pick(r, ["Expense Category", "Category", "Head"]) || "").trim(),
    description: String(pick(r, ["Description", "Particulars", "Narration"]) || "").trim(),
    amount: Number(String(pick(r, ["Amount", "Value"]) ?? "").replace(/,/g, "").replace(/[^0-9.-]/g, "")) || 0,
  }));
}

export const downloadExpenseTemplate = (type: ExpKind) => downloadCSV(`pnl-${type}-expenses-template.csv`, [
  ["Date", "Expense Category", "Description", "Amount"],
  ...(type === "direct"
    ? [["2026-04-05", "Labour", "Factory labour wages", 220000], ["2026-04-12", "Freight Inward", "Transport of CRGO", 45000], ["15-04-2026", "Consumables", "Varnish & tapes", 18000]]
    : [["2026-04-01", "Rent", "Office rent", 60000], ["2026-04-10", "Electricity", "Office electricity", 25000], ["30-04-2026", "Salaries", "Admin staff salaries", 180000]]),
]);

export function ExpenseUploadPreview({ type, rows: initial, onClose, manualMonths }: { type: ExpKind; rows: Draft[]; onClose: () => void; manualMonths: Record<string, number> }) {
  const { db, setDB, log } = useStore();
  const [rows, setRows] = useState(initial);
  const [replaceManual, setReplaceManual] = useState(false);
  const hitManual = [...new Set(rows.map(r => r.date.slice(0, 7)).filter(k => k in manualMonths))].sort();
  const existing = useMemo(() => new Set(expenseRecords(db.settings).map(expKey)), [db.settings]);
  const status = (r: Draft, idx: number) => {
    if (!r.date || !r.category || !(r.amount > 0)) return "invalid";
    if (existing.has(expKey(r))) return "duplicate";
    if (rows.slice(0, idx).some(x => expKey(x) === expKey(r))) return "dup-in-file";
    if (!replaceManual && r.date.slice(0, 7) in manualMonths) return "manual-kept";
    return "new";
  };
  const fresh = rows.filter((r, i) => status(r, i) === "new");
  const upd = (k: number, p: Partial<Draft>) => setRows(rs => rs.map(r => r.key === k ? { ...r, ...p } : r));
  const doImport = () => {
    const now = new Date().toISOString();
    const recs: ExpenseRecord[] = fresh.map(({ key: _k, ...r }) => ({ ...r, id: uid(), createdAt: now }));
    setDB(d => ({ ...d, settings: { ...d.settings, pnlExpenseRecords: [...expenseRecords(d.settings), ...recs] } as any }));
    log(`P&L: imported ${recs.length} ${LABEL[type].toLowerCase()} records (${rows.length - recs.length} skipped)`, "P&L");
    onClose();
  };
  return (
    <Modal open onClose={onClose} title={`Preview Upload — ${LABEL[type]}`} size="xl">
      <div className="space-y-3" data-testid="pnl-exp-preview">
        <div className="text-xs text-slate-500">{rows.length} rows · <b className="text-emerald-600">{fresh.length} new</b> · duplicates and invalid rows are skipped. Edit any cell before importing.</div>
        {hitManual.length > 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-300" data-testid="pnl-exp-manual-warning">
            These months already have a manually entered {LABEL[type].toLowerCase()} value: {hitManual.map(k => `${k} (${fmtINR(manualMonths[k])})`).join(", ")}. Uploaded records would replace it.
            <label className="flex items-center gap-2 mt-1 font-semibold"><input type="checkbox" checked={replaceManual} onChange={e => setReplaceManual(e.target.checked)} data-testid="pnl-exp-replace-manual"/> Replace the manual values with uploaded records for these months</label>
          </div>
        )}
        <div className="max-h-[440px] overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700">
          <Table>
            <thead className="sticky top-0 bg-white dark:bg-slate-900"><tr><Th>Date</Th><Th>Month</Th><Th>Expense Category</Th><Th>Description</Th><Th className="text-right">Amount</Th><Th>Status</Th><Th></Th></tr></thead>
            <tbody>{rows.map((r, i) => { const st = status(r, i); return (
              <tr key={r.key} data-testid={`pnl-exp-preview-row-${i}`}>
                <Td><Input type="date" value={r.date} onChange={(e: any) => upd(r.key, { date: e.target.value })} className="!py-1 h-8 w-36"/></Td>
                <Td className="text-xs">{r.date.slice(0, 7) || "—"}</Td>
                <Td><Input value={r.category} onChange={(e: any) => upd(r.key, { category: e.target.value })} className="!py-1 h-8"/></Td>
                <Td><Input value={r.description} onChange={(e: any) => upd(r.key, { description: e.target.value })} className="!py-1 h-8"/></Td>
                <Td><Input type="number" value={r.amount} onChange={(e: any) => upd(r.key, { amount: Number(e.target.value) || 0 })} className="!py-1 h-8 w-28 text-right"/></Td>
                <Td><Badge color={st === "new" ? "green" : st === "invalid" ? "red" : "yellow"}>{st === "new" ? "New" : st === "invalid" ? "Invalid" : st === "duplicate" ? "Already uploaded" : st === "manual-kept" ? "Skipped · manual value kept" : "Duplicate in file"}</Badge></Td>
                <Td><button type="button" className="text-xs text-rose-600 hover:underline" onClick={() => setRows(rs => rs.filter(x => x.key !== r.key))}>Remove</button></Td>
              </tr>); })}</tbody>
          </Table>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!fresh.length} onClick={doImport} data-testid="pnl-exp-import-btn">Import {fresh.length} record(s) · {fmtINR(fresh.reduce((s, r) => s + r.amount, 0))}</Button>
        </div>
      </div>
    </Modal>
  );
}

export function ExpenseRecordsModal({ type, monthKeys, month, onClose, legacyTotal = 0, onLegacy }: { type: ExpKind; monthKeys: string[]; month?: string; onClose: () => void; legacyTotal?: number; onLegacy?: () => void }) {
  const { db, setDB, log } = useStore();
  const [edit, setEdit] = useState<ExpenseRecord | null>(null);
  const [err, setErr] = useState("");
  const all = expenseRecords(db.settings);
  const list = all.filter(r => r.type === type && (month ? r.date.startsWith(month) : monthKeys.some(k => r.date.startsWith(k)))).sort((a, b) => a.date.localeCompare(b.date));
  const total = list.reduce((s, r) => s + r.amount, 0);
  const save = (recs: ExpenseRecord[]) => setDB(d => ({ ...d, settings: { ...d.settings, pnlExpenseRecords: recs } as any }));
  const del = (r: ExpenseRecord) => { if (!confirm(`Delete ${r.category} · ${r.description} (${fmtINR(r.amount)})?`)) return; save(all.filter(x => x.id !== r.id)); log(`P&L: deleted ${type} expense ${r.category} ${r.date}`, "P&L"); };
  const commit = () => {
    if (!edit) return;
    if (!edit.date || !edit.category || !(edit.amount > 0)) return setErr("Date, category and amount (> 0) are required");
    if (all.some(x => x.id !== edit.id && expKey(x) === expKey(edit))) return setErr("An identical record already exists");
    save(all.map(x => x.id === edit.id ? edit : x)); setEdit(null); setErr("");
  };
  const download = () => downloadCSV(`pnl-${type}-expenses${month ? "-" + month : ""}.csv`, [["Date", "Expense Category", "Description", "Amount"], ...list.map(r => [r.date, r.category, r.description, r.amount])]);
  return (
    <Modal open onClose={onClose} title={`${LABEL[type]} Records${month ? ` — ${month}` : " — FY"}`} size="xl">
      <div className="space-y-3" data-testid="pnl-exp-records-modal">
        <div className="flex items-center justify-between text-sm"><span>{list.length} record(s) · <b className="text-emerald-600">{fmtINR(total)}</b></span><Button variant="outline" size="sm" onClick={download} disabled={!list.length} data-testid="pnl-exp-records-download">Download</Button></div>
        {legacyTotal > 0 && <div className="text-xs text-slate-600 dark:text-slate-300">Plus {fmtINR(legacyTotal)} from older Month/Type uploads · <button type="button" className="text-indigo-600 hover:underline" onClick={onLegacy} data-testid="pnl-exp-legacy-link">view older line items</button></div>}
        {err && <div className="text-xs text-rose-600">{err}</div>}
        <div className="max-h-[440px] overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700">
          <Table>
            <thead className="sticky top-0 bg-white dark:bg-slate-900"><tr><Th>Date</Th><Th>Expense Category</Th><Th>Description</Th><Th className="text-right">Amount</Th><Th></Th></tr></thead>
            <tbody>{list.map(r => edit?.id === r.id ? (
              <tr key={r.id}>
                <Td><Input type="date" value={edit.date} onChange={(e: any) => setEdit({ ...edit, date: e.target.value })} className="!py-1 h-8 w-36"/></Td>
                <Td><Input value={edit.category} onChange={(e: any) => setEdit({ ...edit, category: e.target.value })} className="!py-1 h-8"/></Td>
                <Td><Input value={edit.description} onChange={(e: any) => setEdit({ ...edit, description: e.target.value })} className="!py-1 h-8"/></Td>
                <Td><Input type="number" value={edit.amount} onChange={(e: any) => setEdit({ ...edit, amount: Number(e.target.value) || 0 })} className="!py-1 h-8 w-28 text-right"/></Td>
                <Td className="whitespace-nowrap"><button type="button" className="text-xs text-emerald-600 hover:underline mr-2" onClick={commit} data-testid={`pnl-exp-save-${r.id}`}>Save</button><button type="button" className="text-xs text-slate-500 hover:underline" onClick={() => { setEdit(null); setErr(""); }}>Cancel</button></Td>
              </tr>
            ) : (
              <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <Td>{r.date}</Td><Td className="font-medium">{r.category}</Td><Td>{r.description}</Td><Td className="text-right font-semibold">{fmtINR(r.amount)}</Td>
                <Td className="whitespace-nowrap"><button type="button" className="text-xs text-indigo-600 hover:underline mr-2" onClick={() => setEdit({ ...r })} data-testid={`pnl-exp-edit-${r.id}`}>Edit</button><button type="button" className="text-xs text-rose-600 hover:underline" onClick={() => del(r)} data-testid={`pnl-exp-del-${r.id}`}>Delete</button></Td>
              </tr>
            ))}</tbody>
          </Table>
          {!list.length && <Empty title="No records" subtitle="Upload an Excel file to add expense records"/>}
        </div>
        <div className="flex justify-end"><Button variant="ghost" onClick={onClose}>Close</Button></div>
      </div>
    </Modal>
  );
}
