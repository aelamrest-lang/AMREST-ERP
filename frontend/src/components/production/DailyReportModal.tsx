import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { useStore } from "../../lib/store";
import { Button, Input, Select, Modal, Table, Th, Td, Empty } from "../ui";
import { fmt2, printArea, professionalDocument, todayISO } from "../../lib/utils";

type Mode = "today" | "yesterday" | "range";
const isoD = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function DailyReportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { db } = useStore();
  const [mode, setMode] = useState<Mode>("today");
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [jc, setJc] = useState("");
  const [stage, setStage] = useState("");
  const [op, setOp] = useState("");

  const range = useMemo(() => {
    const t = todayISO();
    if (mode === "today") return { from: t, to: t };
    if (mode === "yesterday") { const d = new Date(); d.setDate(d.getDate() - 1); const y = isoD(d); return { from: y, to: y }; }
    return from <= to ? { from, to } : { from: to, to: from };
  }, [mode, from, to]);

  const jcNo = (id: string, fallback?: string) => (db.jobCards.find(j => j.id === id)?.number || fallback || "—").split(" - ")[0];
  const inRange = db.productionEntries.filter(e => e.date >= range.from && e.date <= range.to);
  const rows = useMemo(() => {
    const m = new Map<string, { date: string; jcId: string; jc: string; product: string; stage: string; operator: string; qty: number }>();
    inRange.filter(e => (!jc || e.jobCardId === jc) && (!stage || e.stage === stage) && (!op || (e.operatorName || "—") === op)).forEach(e => {
      const k = [e.date, e.jobCardId, e.stage, e.operatorName].join("|");
      const r = m.get(k) || { date: e.date, jcId: e.jobCardId, jc: jcNo(e.jobCardId, e.jobCardNumber), product: e.productName || db.jobCards.find(j => j.id === e.jobCardId)?.product || "—", stage: e.stage, operator: e.operatorName || "—", qty: 0 };
      r.qty += Number(e.todayQty) || 0;
      m.set(k, r);
    });
    return [...m.values()].sort((a, b) => b.date.localeCompare(a.date) || a.jc.localeCompare(b.jc) || a.stage.localeCompare(b.stage));
  }, [inRange, jc, stage, op]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = rows.reduce((s, r) => s + r.qty, 0);
  const opts = (f: (e: any) => string) => [...new Set(inRange.map(f))].filter(Boolean).sort();
  const label = range.from === range.to ? range.from : `${range.from} to ${range.to}`;

  const exportXlsx = () => {
    const ws = XLSX.utils.aoa_to_sheet([["Date", "Job Card Number", "Product Name", "Production Stage", "Total Production Qty", "Operator Name"],
      ...rows.map(r => [r.date, r.jc, r.product, r.stage, r.qty, r.operator]), ["", "", "", "Total", total, ""]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Daily Production");
    XLSX.writeFile(wb, `production-daily-report-${label.replace(/ /g, "_")}.xlsx`);
  };
  const print = () => {
    const body = `<table><thead><tr><th>Date</th><th>Job Card</th><th>Product</th><th>Stage</th><th class="right">Total Qty</th><th>Operator</th></tr></thead><tbody>${rows.map(r => `<tr><td>${r.date}</td><td>${r.jc}</td><td>${r.product}</td><td>${r.stage}</td><td class="right">${fmt2(r.qty)}</td><td>${r.operator}</td></tr>`).join("")}<tr><td colspan="4"><b>Total</b></td><td class="right"><b>${fmt2(total)}</b></td><td></td></tr></tbody></table>`;
    printArea(professionalDocument(db.settings, { title: "Production Daily Report", number: label, date: todayISO(), body }), `production-daily-${label}`);
  };

  return (
    <Modal open={open} onClose={onClose} title="Production Daily Report" size="xl">
      <div className="space-y-3" data-testid="daily-report-modal">
        <div className="flex flex-wrap items-center gap-2">
          {([["today", "Today"], ["yesterday", "Yesterday"], ["range", "Custom Date Range"]] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setMode(k)} data-testid={`dr-mode-${k}`}
              className={"text-xs px-3 py-1.5 rounded-full border font-medium " + (mode === k ? "bg-indigo-600 border-indigo-600 text-white" : "bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-600")}>{l}</button>
          ))}
          {mode === "range" && <>
            <Input type="date" className="!w-40" value={from} onChange={(e: any) => setFrom(e.target.value)} data-testid="dr-from"/>
            <span className="text-xs text-slate-400">to</span>
            <Input type="date" className="!w-40" value={to} onChange={(e: any) => setTo(e.target.value)} data-testid="dr-to"/>
          </>}
          <span className="text-xs text-slate-500 ml-auto" data-testid="dr-label">{label}</span>
        </div>
        <div className="grid sm:grid-cols-3 gap-2">
          <Select value={jc} onChange={(e: any) => setJc(e.target.value)} data-testid="dr-filter-jc"><option value="">All Job Cards</option>{opts(e => e.jobCardId).map(id => <option key={id} value={id}>{jcNo(id)}</option>)}</Select>
          <Select value={stage} onChange={(e: any) => setStage(e.target.value)} data-testid="dr-filter-stage"><option value="">All Stages</option>{opts(e => e.stage).map(s => <option key={s} value={s}>{s}</option>)}</Select>
          <Select value={op} onChange={(e: any) => setOp(e.target.value)} data-testid="dr-filter-operator"><option value="">All Operators</option>{opts(e => e.operatorName || "—").map(o => <option key={o} value={o}>{o}</option>)}</Select>
        </div>
        <div className="max-h-[460px] overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700">
          <Table>
            <thead className="sticky top-0 bg-white dark:bg-slate-900"><tr><Th>Date</Th><Th>Job Card Number</Th><Th>Product Name</Th><Th>Production Stage</Th><Th className="text-right">Total Production Qty</Th><Th>Operator Name</Th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} data-testid={`dr-row-${i}`}><Td>{r.date}</Td><Td className="font-mono text-xs">{r.jc}</Td><Td>{r.product}</Td><Td>{r.stage}</Td><Td className="text-right font-semibold">{fmt2(r.qty)}</Td><Td>{r.operator}</Td></tr>
              ))}
              {rows.length > 0 && <tr className="bg-slate-50 dark:bg-slate-800/60 font-bold"><Td colSpan={4}>Total</Td><Td className="text-right" data-testid="dr-total">{fmt2(total)}</Td><Td></Td></tr>}
            </tbody>
          </Table>
          {!rows.length && <Empty title="No production entries" subtitle={`Nothing recorded for ${label}`}/>}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={print} disabled={!rows.length} data-testid="dr-print">Print / PDF</Button>
          <Button onClick={exportXlsx} disabled={!rows.length} data-testid="dr-export">Export Excel</Button>
        </div>
      </div>
    </Modal>
  );
}
