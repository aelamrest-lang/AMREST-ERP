import { useMemo, useState } from "react";
import { useStore } from "../../lib/store";
import { Button, Input, Select, Label, Modal, Table, Th, Td, Badge } from "../ui";
import { IconX } from "../icons";
import type { JobCard } from "../../lib/types";

type ConsRow = { itemId: string; qtyPerUnit: number };
type Row = { stage: string; produced: string; cons: ConsRow[] };
type Mode = "keep" | "replace";

const jcNo = (j?: JobCard) => (j?.number || "").split(" - ")[0];

export function CopyMappingModal({ open, onClose, initialSource, stages }: { open: boolean; onClose: () => void; initialSource: string; stages: string[] }) {
  const { db, setDB, log } = useStore();
  const prodMap = db.settings.sfgStageItemsByJc || {};
  const consMap = db.settings.sfgConsumptionMapByJc || {};
  const sfgItems = db.items.filter(i => i.category === "Semi-Finished");
  const isMapped = (id: string) => Object.values(prodMap[id] || {}).some(Boolean) || Object.values(consMap[id] || {}).some(v => (v || []).length);
  const sources = db.jobCards.filter(j => isMapped(j.id));

  const [source, setSource] = useState(isMapped(initialSource) ? initialSource : "");
  const [rows, setRows] = useState<Row[]>(() => loadRows(isMapped(initialSource) ? initialSource : ""));
  const [targets, setTargets] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<Mode>("keep");
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [step, setStep] = useState<"edit" | "preview">("edit");

  function loadRows(jcId: string): Row[] {
    if (!jcId) return [];
    const keys = new Set([...Object.keys(prodMap[jcId] || {}).filter(k => prodMap[jcId][k]), ...Object.keys(consMap[jcId] || {}).filter(k => (consMap[jcId][k] || []).length)]);
    return [...keys].map(stage => ({ stage, produced: prodMap[jcId]?.[stage] || "", cons: (consMap[jcId]?.[stage] || []).map(r => ({ ...r })) }));
  }

  const src = db.jobCards.find(j => j.id === source);
  const similar = (j: JobCard) => !!src && ((!!src.bomId && j.bomId === src.bomId) || j.product.trim().toLowerCase() === src.product.trim().toLowerCase());
  const targetList = useMemo(() => db.jobCards.filter(j => j.id !== source)
    .filter(j => !q || `${j.number} ${j.product}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(similar(b)) - Number(similar(a)) || b.number.localeCompare(a.number)), [db.jobCards, source, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const itemName = (id: string) => db.items.find(i => i.id === id)?.name || "—";
  const updRow = (idx: number, patch: Partial<Row>) => setRows(rs => rs.map((r, i) => i === idx ? { ...r, ...patch } : r));

  const errors = useMemo(() => {
    const e: string[] = [];
    const seen = new Map<string, string>();
    rows.forEach(r => {
      if (!r.produced && !r.cons.length) e.push(`${r.stage}: nothing mapped — remove the stage or pick an SFG`);
      if (r.produced && !sfgItems.some(i => i.id === r.produced)) e.push(`${r.stage}: produced item is not a valid SFG item`);
      if (r.produced && seen.has(r.produced)) e.push(`${itemName(r.produced)} is produced by both ${seen.get(r.produced)} and ${r.stage}`);
      if (r.produced) seen.set(r.produced, r.stage);
      if (r.cons.some(c => c.itemId === r.produced)) e.push(`${r.stage}: cannot consume the SFG it produces`);
      if (new Set(r.cons.map(c => c.itemId)).size !== r.cons.length) e.push(`${r.stage}: duplicate consumed SFG`);
      r.cons.forEach(c => { if (!sfgItems.some(i => i.id === c.itemId)) e.push(`${r.stage}: consumed item is not a valid SFG item`); if (!(c.qtyPerUnit > 0)) e.push(`${r.stage}: consumption qty for ${itemName(c.itemId)} must be > 0`); });
    });
    if (!rows.length) e.push("Mapping is empty");
    if (!targets.length) e.push("Select at least one target Job Card");
    if (mode === "replace" && targets.some(isMapped) && !confirmReplace) e.push("Tick the confirmation to replace existing mappings");
    return e;
  }, [rows, targets, mode, confirmReplace]); // eslint-disable-line react-hooks/exhaustive-deps

  const plan = targets.map(tid => {
    const jc = db.jobCards.find(j => j.id === tid)!;
    const jcStages = new Set((jc.stages || []).map(s => s.stage));
    const existingStages = new Set([...Object.keys(prodMap[tid] || {}).filter(k => prodMap[tid][k]), ...Object.keys(consMap[tid] || {}).filter(k => (consMap[tid][k] || []).length)]);
    const applicable = rows.filter(r => jcStages.has(r.stage));
    const skippedMissing = rows.filter(r => !jcStages.has(r.stage)).map(r => r.stage);
    const kept = mode === "keep" ? applicable.filter(r => existingStages.has(r.stage)).map(r => r.stage) : [];
    const apply = applicable.filter(r => !kept.includes(r.stage));
    return { jc, existing: existingStages.size, apply, kept, skippedMissing };
  });

  const save = () => {
    if (errors.length) return;
    setDB(d => {
      const p = { ...(d.settings.sfgStageItemsByJc || {}) };
      const c = { ...(d.settings.sfgConsumptionMapByJc || {}) };
      plan.forEach(({ jc, apply }) => {
        const np: Record<string, string> = mode === "replace" ? {} : { ...(p[jc.id] || {}) };
        const nc: Record<string, ConsRow[]> = mode === "replace" ? {} : { ...(c[jc.id] || {}) };
        apply.forEach(r => { if (r.produced) np[r.stage] = r.produced; else delete np[r.stage]; if (r.cons.length) nc[r.stage] = r.cons.map(x => ({ ...x })); else delete nc[r.stage]; });
        p[jc.id] = np; c[jc.id] = nc;
      });
      return { ...d, settings: { ...d.settings, sfgStageItemsByJc: p, sfgConsumptionMapByJc: c } };
    });
    log(`Copied SFG mapping from ${jcNo(src)} to ${plan.map(x => `${jcNo(x.jc)} (${x.apply.length} stages)`).join(", ")}${mode === "replace" ? " — replaced existing" : ""}`, "Production SFG");
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Copy SFG Mapping to Job Cards" size="xl">
      {step === "edit" ? (
        <div className="space-y-4 text-sm" data-testid="copy-map-modal">
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <Label>Source Job Card (with SFG mapping)</Label>
              <Select value={source} onChange={(e: any) => { setSource(e.target.value); setRows(loadRows(e.target.value)); setTargets(t => t.filter(x => x !== e.target.value)); }} data-testid="copy-map-source">
                <option value="">Select source…</option>
                {sources.map(j => <option key={j.id} value={j.id}>{j.number} · {j.product}</option>)}
              </Select>
              <div className="text-[11px] text-slate-500 mt-1">The source mapping is never modified — only configuration is copied (no stock or transactions).</div>
            </div>
            <div>
              <Label>Target Job Cards ({targets.length} selected)</Label>
              <Input value={q} onChange={(e: any) => setQ(e.target.value)} placeholder="Search job card / product…" data-testid="copy-map-target-search"/>
              <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
                {targetList.map(j => (
                  <label key={j.id} className="flex items-center gap-2 px-2 py-1.5 text-xs cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <input type="checkbox" checked={targets.includes(j.id)} onChange={e => setTargets(t => e.target.checked ? [...t, j.id] : t.filter(x => x !== j.id))} data-testid={`copy-map-target-${jcNo(j)}`}/>
                    <span className="flex-1 truncate">{j.number} · {j.product}</span>
                    {similar(j) && <Badge color="green">Similar</Badge>}
                    {isMapped(j.id) && <Badge color="yellow">Has mapping</Badge>}
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between px-3 py-2 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700">
              <div className="font-semibold text-xs">Mapping to copy (editable)</div>
              <Select value="" className="!w-60" onChange={(e: any) => e.target.value && setRows(rs => [...rs, { stage: e.target.value, produced: "", cons: [] }])} data-testid="copy-map-add-stage">
                <option value="">+ Add stage…</option>
                {stages.filter(s => !rows.some(r => r.stage === s)).map(s => <option key={s} value={s}>{s}</option>)}
              </Select>
            </div>
            <Table>
              <thead><tr><Th>Stage</Th><Th>SFG Produced</Th><Th>SFG Consumed (qty per unit)</Th></tr></thead>
              <tbody>
                {rows.map((r, idx) => (
                  <tr key={r.stage} className="align-top">
                    <Td className="font-medium whitespace-nowrap"><button type="button" className="text-slate-400 hover:text-rose-600 mr-2" onClick={() => setRows(rs => rs.filter((_, i) => i !== idx))} data-testid={`copy-map-remove-${idx}`}><IconX size={13}/></button>{r.stage}</Td>
                    <Td><Select value={r.produced} onChange={(e: any) => updRow(idx, { produced: e.target.value })} data-testid={`copy-map-produced-${idx}`}>
                      <option value="">— Not mapped —</option>
                      {sfgItems.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                    </Select></Td>
                    <Td><div className="space-y-1 min-w-64">
                      {r.cons.map((c, k) => (
                        <div key={k} className="flex items-center gap-1.5">
                          <span className="flex-1 text-xs truncate">{itemName(c.itemId)}</span>
                          <Input type="number" className="!w-20 !py-1 text-xs" value={c.qtyPerUnit || ""} onChange={(e: any) => updRow(idx, { cons: r.cons.map((x, i) => i === k ? { ...x, qtyPerUnit: Number(e.target.value) } : x) })} data-testid={`copy-map-cons-qty-${idx}-${k}`}/>
                          <button type="button" className="text-slate-400 hover:text-rose-600" onClick={() => updRow(idx, { cons: r.cons.filter((_, i) => i !== k) })}><IconX size={12}/></button>
                        </div>
                      ))}
                      <Select value="" onChange={(e: any) => e.target.value && updRow(idx, { cons: [...r.cons, { itemId: e.target.value, qtyPerUnit: 1 }] })} data-testid={`copy-map-cons-add-${idx}`}>
                        <option value="">+ Add SFG consumed…</option>
                        {sfgItems.filter(i => i.id !== r.produced && !r.cons.some(c => c.itemId === i.id)).map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                      </Select>
                    </div></Td>
                  </tr>
                ))}
                {!rows.length && <tr><Td colSpan={3} className="text-center text-xs text-slate-500 py-6">Select a source job card to load its mapping</Td></tr>}
              </tbody>
            </Table>
          </div>

          <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2">
            <div className="font-semibold text-xs">If a target already has a mapping</div>
            <label className="flex items-center gap-2 text-xs"><input type="radio" checked={mode === "keep"} onChange={() => setMode("keep")} data-testid="copy-map-mode-keep"/> Keep existing — only add stages that are not mapped yet</label>
            <label className="flex items-center gap-2 text-xs"><input type="radio" checked={mode === "replace"} onChange={() => setMode("replace")} data-testid="copy-map-mode-replace"/> Replace the target's whole mapping with this one</label>
            {mode === "replace" && <label className="flex items-center gap-2 text-xs text-rose-600 ml-5"><input type="checkbox" checked={confirmReplace} onChange={e => setConfirmReplace(e.target.checked)} data-testid="copy-map-confirm-replace"/> I confirm existing mappings of the selected targets will be replaced</label>}
          </div>

          {errors.length > 0 && <ul className="text-xs text-rose-600 list-disc ml-5" data-testid="copy-map-errors">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button disabled={errors.length > 0} onClick={() => setStep("preview")} data-testid="copy-map-preview-btn">Preview</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4 text-sm" data-testid="copy-map-preview">
          <div className="text-xs text-slate-500">Copying from <b>{src?.number}</b> · mode: <b>{mode === "replace" ? "Replace existing" : "Keep existing"}</b></div>
          {plan.map(p => (
            <div key={p.jc.id} className="rounded-lg border border-slate-200 dark:border-slate-700" data-testid={`copy-map-plan-${jcNo(p.jc)}`}>
              <div className="px-3 py-2 bg-slate-50 dark:bg-slate-800/60 flex flex-wrap items-center gap-2 text-xs">
                <b>{p.jc.number}</b><span className="text-slate-500">{p.jc.product}</span>
                <Badge color="green">{p.apply.length} stage(s) applied</Badge>
                {p.kept.length > 0 && <Badge color="yellow">{p.kept.length} kept as is: {p.kept.join(", ")}</Badge>}
                {p.skippedMissing.length > 0 && <Badge color="red">skipped (stage not in job card): {p.skippedMissing.join(", ")}</Badge>}
                {mode === "replace" && p.existing > 0 && <Badge color="red">replaces {p.existing} existing</Badge>}
              </div>
              {p.apply.length > 0 && <Table>
                <thead><tr><Th>Stage</Th><Th>Produces</Th><Th>Consumes</Th></tr></thead>
                <tbody>{p.apply.map(r => (
                  <tr key={r.stage}><Td className="font-medium">{r.stage}</Td><Td>{r.produced ? itemName(r.produced) : "—"}</Td><Td className="text-xs">{r.cons.map(c => `${itemName(c.itemId)} × ${c.qtyPerUnit}`).join(", ") || "—"}</Td></tr>
                ))}</tbody>
              </Table>}
            </div>
          ))}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setStep("edit")} data-testid="copy-map-back-btn">Back to edit</Button>
            <Button onClick={save} disabled={plan.every(p => !p.apply.length) && mode !== "replace"} data-testid="copy-map-save-btn">Confirm &amp; Save to {plan.length} Job Card(s)</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
