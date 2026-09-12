import { useMemo, useState } from "react";
import { useStore, uid } from "../lib/store";
import { Card, Button, Input, Select, Label, Modal, Table, Th, Td, Badge, Empty, KPI, Textarea } from "../components/ui";
import { IconBox, IconFactory, IconPlus, IconTrash, IconSearch, IconRefresh, IconClipboard } from "../components/icons";
import { fmt2, todayISO } from "../lib/utils";
import { userCan } from "../lib/permissions";
import { sfgStages, sfgAvailable, consumeSfgItems } from "../lib/sfg";
import type { Item } from "../lib/types";

export function ProductionSFG() {
  const { db, setDB, log, currentUser } = useStore();
  const canEdit = currentUser?.role === "admin" || userCan(currentUser, "production", "edit");
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [tab, setTab] = useState<"stock" | "history">("stock");
  const [consumeOpen, setConsumeOpen] = useState(false);
  const [mapDraft, setMapDraft] = useState<Record<string, string>>({});
  const [consStage, setConsStage] = useState("");
  const [consDraft, setConsDraft] = useState<{ itemId: string; qtyPerUnit: number }[]>([]);
  const [mcItem, setMcItem] = useState("");
  const [mcQty, setMcQty] = useState(0);
  const [mcStage, setMcStage] = useState("");
  const [mcJc, setMcJc] = useState("");
  const [mcRemarks, setMcRemarks] = useState("");
  const [mcError, setMcError] = useState("");
  const [batchDrill, setBatchDrill] = useState<string | null>(null);

  const stages = useMemo(() => sfgStages(db), [db]);
  const sfgItems = useMemo(() => db.items.filter(i => i.category === "Semi-Finished"), [db.items]);
  const stageMap = db.settings.sfgStageItems || {};
  const consMap = db.settings.sfgConsumptionMap || {};
  const batches = db.sfgBatches || [];
  const consumptions = db.sfgConsumptions || [];

  const itemById = (id: string) => db.items.find(i => i.id === id);
  const batchAvailableByItem = useMemo(() => {
    const m = new Map<string, number>();
    batches.forEach(b => m.set(b.itemId, (m.get(b.itemId) || 0) + sfgAvailable(b)));
    return m;
  }, [batches]);

  const totalProduced = batches.reduce((s, b) => s + b.qtyProduced, 0);
  const totalUsed = batches.reduce((s, b) => s + b.qtyUsed, 0);
  const totalAvailable = batches.reduce((s, b) => s + sfgAvailable(b), 0);

  const stockRows = useMemo(() => {
    return batches.filter(b => {
      const item = itemById(b.itemId);
      const text = `${item?.name || ""} ${b.jobCardNumber} ${b.stage}`.toLowerCase();
      const okSearch = !search || text.includes(search.toLowerCase());
      const okStage = stageFilter === "all" || b.stage === stageFilter;
      return okSearch && okStage;
    }).slice().sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
  }, [batches, search, stageFilter, db.items]);

  const historyRows = useMemo(() => {
    const prod = batches.map(b => ({
      id: `p-${b.id}`, date: b.date, createdAt: b.createdAt, type: "Produced" as const,
      item: itemById(b.itemId)?.name || "—", stage: b.stage, jc: b.jobCardNumber, qty: b.qtyProduced,
      detail: `Entry at ${b.stage}`, mode: "auto" as const,
    }));
    const cons = consumptions.map(c => ({
      id: `c-${c.id}`, date: c.date, createdAt: c.createdAt, type: "Consumed" as const,
      item: itemById(c.itemId)?.name || "—", stage: c.outputStage, jc: c.sourceJobCardNumber,
      qty: c.qty, detail: `→ ${c.outputStage}${c.outputJobCardNumber ? ` (${c.outputJobCardNumber})` : ""}${c.remarks ? ` · ${c.remarks}` : ""}`,
      mode: c.mode,
    }));
    return [...prod, ...cons].sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
  }, [batches, consumptions, db.items]);

  const getMapVal = (stage: string) => mapDraft[stage] ?? stageMap[stage] ?? "";

  const saveMapping = () => {
    setDB(d => ({ ...d, settings: { ...d.settings, sfgStageItems: { ...stageMap, ...mapDraft } } }));
    log("Updated SFG stage-item mapping", "Production SFG");
    setMapDraft({});
  };

  const autoCreateItem = (stage: string) => {
    const name = `${stage} SFG`;
    const existing = db.items.find(i => i.name.toLowerCase() === name.toLowerCase());
    if (existing) { setMapDraft(m => ({ ...m, [stage]: existing.id })); return; }
    const item: Item = {
      id: uid(), code: `SFG-${stage.replace(/[^A-Za-z0-9]/g, "").slice(0, 10).toUpperCase()}`, name,
      category: "Semi-Finished", unit: "Nos", gstRate: 18, openingStock: 0, currentStock: 0,
      minStock: 0, reorderLevel: 0, purchaseRate: 0, saleRate: 0,
    };
    setDB(d => ({ ...d, items: [...d.items, item] }));
    log(`Created SFG item ${name}`, "Production SFG");
    setMapDraft(m => ({ ...m, [stage]: item.id }));
  };

  const openConsEditor = (stage: string) => {
    setConsStage(stage);
    setConsDraft((consMap[stage] || []).map(r => ({ ...r })));
  };

  const saveConsMapping = () => {
    const cleaned = consDraft.filter(r => r.itemId && r.qtyPerUnit > 0);
    setDB(d => ({
      ...d,
      settings: { ...d.settings, sfgConsumptionMap: { ...(d.settings.sfgConsumptionMap || {}), [consStage]: cleaned } },
    }));
    log(`Updated SFG consumption map for ${consStage} (${cleaned.length} inputs)`, "Production SFG");
    setConsStage(""); setConsDraft([]);
  };

  const runManualConsume = () => {
    if (!mcItem) return setMcError("Select an SFG item");
    if (mcQty <= 0) return setMcError("Enter a quantity above 0");
    if (!mcStage) return setMcError("Select the consuming stage");
    const jc = db.jobCards.find(j => j.id === mcJc);
    const avail = batchAvailableByItem.get(mcItem) || 0;
    if (mcQty > avail) return setMcError(`Only ${fmt2(avail)} available for this SFG`);
    const { updates, shortages } = consumeSfgItems(db, {
      needs: [{ itemId: mcItem, qty: mcQty }],
      outputStage: mcStage, outputJobCardId: jc?.id, outputJobCardNumber: jc?.number,
      mode: "manual", remarks: mcRemarks || undefined,
    });
    setDB(d => ({ ...d, ...updates }));
    log(`Manual SFG consumption: ${itemById(mcItem)?.name} × ${mcQty} → ${mcStage}`, "Production SFG");
    if (shortages.length) alert("Shortages: " + shortages.join(", "));
    setConsumeOpen(false); setMcItem(""); setMcQty(0); setMcStage(""); setMcJc(""); setMcRemarks(""); setMcError("");
  };

  return (
    <div className="space-y-6" data-testid="production-sfg-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Production SFG</h1>
          <p className="text-sm text-slate-500">Semi-Finished Goods — stage-wise production, stock and consumption</p>
        </div>
        {canEdit && <Button onClick={() => setConsumeOpen(true)} data-testid="open-manual-consume"><IconRefresh size={14}/> Consume SFG</Button>}
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPI label="Mapped Stages" value={String(Object.keys(stageMap).filter(k => stageMap[k]).length)} color="indigo" icon={<IconFactory size={22}/>} hint="stages producing SFG"/>
        <KPI label="SFG Produced" value={fmt2(totalProduced)} color="blue" icon={<IconBox size={22}/>} hint="all-time qty"/>
        <KPI label="SFG Available" value={fmt2(totalAvailable)} color="emerald" icon={<IconBox size={22}/>} hint="ready to consume"/>
        <KPI label="SFG Consumed" value={fmt2(totalUsed)} color="amber" icon={<IconClipboard size={22}/>} hint="used in next stages"/>
      </div>

      {canEdit && (
        <Card>
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <div>
              <h3 className="font-semibold">Stage → SFG Item Mapping</h3>
              <p className="text-xs text-slate-500">A production entry at a mapped stage automatically creates SFG stock of the mapped item</p>
            </div>
            <Button onClick={saveMapping} disabled={!Object.keys(mapDraft).length} data-testid="save-stage-mapping">Save Mapping</Button>
          </div>
          <Table>
            <thead><tr><Th>Production Stage</Th><Th>SFG Item (Semi-Finished)</Th><Th className="text-right">Action</Th></tr></thead>
            <tbody>
              {stages.map(stage => (
                <tr key={stage} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <Td className="font-medium">{stage}</Td>
                  <Td>
                    <Select value={getMapVal(stage)} onChange={(e: any) => setMapDraft(m => ({ ...m, [stage]: e.target.value }))} data-testid={`map-stage-${stage.replace(/\s+/g, "-").toLowerCase()}`}>
                      <option value="">— Not mapped —</option>
                      {sfgItems.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                    </Select>
                  </Td>
                  <Td className="text-right">
                    <Button variant="outline" onClick={() => autoCreateItem(stage)} data-testid={`auto-create-${stage.replace(/\s+/g, "-").toLowerCase()}`}>Auto-create Item</Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {canEdit && (
        <Card>
          <div className="p-4 border-b border-slate-100 dark:border-slate-800">
            <h3 className="font-semibold">SFG Consumption Mapping</h3>
            <p className="text-xs text-slate-500">Inputs auto-consumed when a production entry is logged at the output stage. Supports single or multiple SFG inputs (e.g. LV Winding SFG + HV Winding SFG + Core SFG → Assembly)</p>
          </div>
          <Table>
            <thead><tr><Th>Output Stage</Th><Th>Consumes (per 1 unit produced)</Th><Th className="text-right">Action</Th></tr></thead>
            <tbody>
              {stages.filter(s => (consMap[s] || []).length > 0).map(stage => (
                <tr key={stage} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <Td className="font-medium">{stage}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1.5">
                      {(consMap[stage] || []).map((r, idx) => (
                        <Badge key={idx} color="blue">{itemById(r.itemId)?.name || "?"} × {r.qtyPerUnit}</Badge>
                      ))}
                    </div>
                  </Td>
                  <Td className="text-right"><Button variant="outline" onClick={() => openConsEditor(stage)} data-testid={`edit-cons-${stage.replace(/\s+/g, "-").toLowerCase()}`}>Edit</Button></Td>
                </tr>
              ))}
              {stages.every(s => !(consMap[s] || []).length) && (
                <tr><Td colSpan={3}><Empty title="No consumption mappings yet" subtitle="Pick a stage below to define its SFG inputs" /></Td></tr>
              )}
            </tbody>
          </Table>
          <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-end gap-2">
            <div className="w-56">
              <Label className="text-[10px]">Output Stage</Label>
              <Select value={consStage} onChange={(e: any) => e.target.value ? openConsEditor(e.target.value) : setConsStage("")} data-testid="cons-stage-picker">
                <option value="">Select stage to configure…</option>
                {stages.map(s => <option key={s} value={s}>{s}</option>)}
              </Select>
            </div>
          </div>
          {consStage && (
            <div className="p-4 border-t border-slate-100 dark:border-slate-800 space-y-3" data-testid="cons-editor">
              <div className="text-sm font-semibold">Inputs for <span className="text-indigo-600">{consStage}</span> (consumed per 1 unit produced)</div>
              {consDraft.map((row, idx) => (
                <div key={idx} className="flex flex-wrap items-end gap-2">
                  <div className="flex-1 min-w-52">
                    <Label className="text-[10px]">Input SFG Item</Label>
                    <Select value={row.itemId} onChange={(e: any) => setConsDraft(d => d.map((r, i) => i === idx ? { ...r, itemId: e.target.value } : r))} data-testid={`cons-input-item-${idx}`}>
                      <option value="">Select SFG item…</option>
                      {sfgItems.map(i => <option key={i.id} value={i.id}>{i.name} (avail {fmt2(batchAvailableByItem.get(i.id) || 0)})</option>)}
                    </Select>
                  </div>
                  <div className="w-28">
                    <Label className="text-[10px]">Qty / Unit</Label>
                    <Input type="number" value={row.qtyPerUnit || ""} onChange={(e: any) => setConsDraft(d => d.map((r, i) => i === idx ? { ...r, qtyPerUnit: Number(e.target.value) } : r))} data-testid={`cons-input-qty-${idx}`} />
                  </div>
                  <Button variant="outline" onClick={() => setConsDraft(d => d.filter((_, i) => i !== idx))} data-testid={`cons-input-remove-${idx}`}><IconTrash size={14}/></Button>
                </div>
              ))}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setConsDraft(d => [...d, { itemId: "", qtyPerUnit: 1 }])} data-testid="cons-add-input"><IconPlus size={14}/> Add Input</Button>
                <Button onClick={saveConsMapping} data-testid="cons-save">Save Consumption Map</Button>
                <Button variant="outline" onClick={() => { setConsStage(""); setConsDraft([]); }}>Cancel</Button>
              </div>
            </div>
          )}
        </Card>
      )}

      <Card>
        <div className="p-4 flex flex-wrap items-center gap-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
            <button type="button" onClick={() => setTab("stock")} className={"px-4 py-2 text-xs font-semibold " + (tab === "stock" ? "bg-indigo-600 text-white" : "bg-white dark:bg-slate-900 text-slate-600")} data-testid="tab-stock">SFG Stock</button>
            <button type="button" onClick={() => setTab("history")} className={"px-4 py-2 text-xs font-semibold " + (tab === "history" ? "bg-indigo-600 text-white" : "bg-white dark:bg-slate-900 text-slate-600")} data-testid="tab-history">History</button>
          </div>
          <div className="flex-1 min-w-48 relative">
            <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
            <Input className="pl-9" placeholder="Search by item, job card or stage..." value={search} onChange={(e: any) => setSearch(e.target.value)} data-testid="sfg-search" />
          </div>
          <Select value={stageFilter} onChange={(e: any) => setStageFilter(e.target.value)} className="w-52" data-testid="sfg-stage-filter">
            <option value="all">All Stages</option>
            {stages.map(s => <option key={s} value={s}>{s}</option>)}
          </Select>
        </div>

        {tab === "stock" && (
          <>
            <Table>
              <thead><tr>
                <Th>Date</Th><Th>Job Card No.</Th><Th>Stage</Th><Th>SFG Item</Th>
                <Th className="text-right">SFG Qty</Th><Th className="text-right">Used Qty</Th><Th className="text-right">Available Qty</Th><Th>Status</Th>
              </tr></thead>
              <tbody>
                {stockRows.map(b => {
                  const item = itemById(b.itemId);
                  const avail = sfgAvailable(b);
                  return (
                    <tr key={b.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50" data-testid={`sfg-batch-${b.id}`}>
                      <Td>{b.date}</Td>
                      <Td className="font-mono text-xs">{b.jobCardNumber}</Td>
                      <Td><Badge color="blue">{b.stage}</Badge></Td>
                      <Td className="font-medium">{item?.name || "—"} <span className="text-[10px] text-slate-400">{item?.unit}</span></Td>
                      <Td className="text-right font-semibold">{fmt2(b.qtyProduced)}</Td>
                      <Td className="text-right text-amber-600 font-semibold">
                        {b.qtyUsed > 0 ? (
                          <button type="button" className="hover:underline" title="View which stage/job card consumed this batch" onClick={() => setBatchDrill(b.id)} data-testid={`sfg-used-${b.id}`}>{fmt2(b.qtyUsed)}</button>
                        ) : fmt2(b.qtyUsed)}
                      </Td>
                      <Td className="text-right"><span className={avail > 0 ? "text-emerald-600 font-bold" : "text-slate-400 font-semibold"}>{fmt2(avail)}</span></Td>
                      <Td><Badge color={avail > 0 ? "green" : "red"}>{avail > 0 ? "In Stock" : "Fully Consumed"}</Badge></Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            {stockRows.length === 0 && <Empty title="No SFG stock yet" subtitle="Map stages to SFG items above, then log production entries" />}
          </>
        )}

        {tab === "history" && (
          <>
            <Table>
              <thead><tr>
                <Th>Date</Th><Th>Type</Th><Th>SFG Item</Th><Th>Stage</Th><Th>Job Card No.</Th>
                <Th className="text-right">Qty</Th><Th>Mode</Th><Th>Details</Th>
              </tr></thead>
              <tbody>
                {historyRows.map(h => (
                  <tr key={h.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <Td>{h.date}</Td>
                    <Td><Badge color={h.type === "Produced" ? "green" : "yellow"}>{h.type}</Badge></Td>
                    <Td className="font-medium">{h.item}</Td>
                    <Td>{h.stage}</Td>
                    <Td className="font-mono text-xs">{h.jc}</Td>
                    <Td className="text-right font-semibold">{fmt2(h.qty)}</Td>
                    <Td><Badge color={h.mode === "auto" ? "blue" : "red"}>{h.mode === "auto" ? "Auto" : "Manual"}</Badge></Td>
                    <Td className="text-xs text-slate-500">{h.detail}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {historyRows.length === 0 && <Empty title="No SFG history yet" />}
          </>
        )}
      </Card>

      <Modal open={!!batchDrill} onClose={() => setBatchDrill(null)} title="Consumption Details — Job Card-wise" size="lg">
        {batchDrill && (() => {
          const batch = batches.find(b => b.id === batchDrill);
          const item = batch ? itemById(batch.itemId) : undefined;
          const rows = consumptions.filter(c => c.batchId === batchDrill).slice().sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
          return (
            <div className="space-y-3" data-testid="batch-drill-modal">
              <div className="text-xs text-slate-500">
                SFG Item <b>{item?.name}</b> · Produced under JC <b>{batch?.jobCardNumber}</b> at stage <b>{batch?.stage}</b> on <b>{batch?.date}</b> · Qty <b>{fmt2(batch?.qtyProduced || 0)}</b>
              </div>
              <Table>
                <thead><tr>
                  <Th>Date</Th><Th>Consumed Qty</Th><Th>Consuming Stage</Th><Th>Consuming Job Card</Th><Th>Mode</Th><Th>Remarks</Th>
                </tr></thead>
                <tbody>
                  {rows.map(c => (
                    <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <Td>{c.date}</Td>
                      <Td className="font-semibold text-amber-600">{fmt2(c.qty)}</Td>
                      <Td><Badge color="blue">{c.outputStage}</Badge></Td>
                      <Td className="font-mono text-xs">{c.outputJobCardNumber || "—"}</Td>
                      <Td><Badge color={c.mode === "auto" ? "blue" : "red"}>{c.mode === "auto" ? "Auto" : "Manual"}</Badge></Td>
                      <Td className="text-xs text-slate-500">{c.remarks || "—"}</Td>
                    </tr>
                  ))}
                  {rows.length === 0 && <tr><Td colSpan={6}><Empty title="No consumption recorded for this batch" /></Td></tr>}
                </tbody>
              </Table>
              <div className="flex justify-end pt-2 border-t border-slate-200 dark:border-slate-700">
                <Button variant="outline" onClick={() => setBatchDrill(null)}>Close</Button>
              </div>
            </div>
          );
        })()}
      </Modal>

      <Modal open={consumeOpen} onClose={() => setConsumeOpen(false)} title="Consume SFG Manually" size="md">
        <div className="space-y-3">
          <div>
            <Label>SFG Item</Label>
            <Select value={mcItem} onChange={(e: any) => setMcItem(e.target.value)} data-testid="mc-item">
              <option value="">Select SFG item…</option>
              {sfgItems.filter(i => (batchAvailableByItem.get(i.id) || 0) > 0).map(i => (
                <option key={i.id} value={i.id}>{i.name} — available {fmt2(batchAvailableByItem.get(i.id) || 0)} {i.unit}</option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Qty to Consume</Label>
              <Input type="number" value={mcQty || ""} onChange={(e: any) => setMcQty(Number(e.target.value))} data-testid="mc-qty" />
            </div>
            <div>
              <Label>Consuming Stage</Label>
              <Select value={mcStage} onChange={(e: any) => setMcStage(e.target.value)} data-testid="mc-stage">
                <option value="">Select stage…</option>
                {stages.map(s => <option key={s} value={s}>{s}</option>)}
              </Select>
            </div>
          </div>
          <div>
            <Label>For Job Card (optional)</Label>
            <Select value={mcJc} onChange={(e: any) => setMcJc(e.target.value)} data-testid="mc-jc">
              <option value="">— None —</option>
              {db.jobCards.filter(j => j.status !== "Completed").map(j => <option key={j.id} value={j.id}>{j.number} · {j.product}</option>)}
            </Select>
          </div>
          <div>
            <Label>Remarks</Label>
            <Textarea value={mcRemarks} onChange={(e: any) => setMcRemarks(e.target.value)} data-testid="mc-remarks" />
          </div>
          {mcError && <div className="text-xs text-rose-600" data-testid="mc-error">{mcError}</div>}
          <div className="text-[11px] text-slate-500">Consumption is FIFO — batches from the selected job card are used first, then oldest batches.</div>
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-700">
            <Button variant="outline" onClick={() => setConsumeOpen(false)}>Cancel</Button>
            <Button onClick={runManualConsume} data-testid="mc-submit">Consume</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
