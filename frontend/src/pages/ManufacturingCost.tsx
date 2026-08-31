import { useMemo, useState, useEffect } from "react";
import { useStore } from "../lib/store";
import { Card, Button, Input, Select, Label, Table, Th, Td, Empty, Badge, KPI } from "../components/ui";
import { fmtINR } from "../lib/utils";

interface CostRow { itemId: string; qty: number; rate: number; amount: number }

export function ManufacturingCost() {
  const { db, setDB, log, currentUser } = useStore();
  // Show only Finished Goods that have at least one BOM linked (by matching name, case-insensitive substring)
  const finishedGoods = useMemo(() => {
    const bomNames = db.boms.map(b => (b.name || "").trim().toLowerCase()).filter(Boolean);
    return db.items.filter(i => {
      if (i.category !== "Finished Goods") return false;
      const n = i.name.trim().toLowerCase();
      return bomNames.some(bn => bn === n || bn.includes(n) || n.includes(bn));
    });
  }, [db.items, db.boms]);

  const persisted = useMemo(() => ((db.settings as any).manufacturingCosts || {}) as Record<string, any>, [db.settings]);

  const [fgId, setFgId] = useState<string>(finishedGoods[0]?.id || "");
  const [bomId, setBomId] = useState<string>("");
  const [labour, setLabour] = useState<number>(0);
  const [office, setOffice] = useState<number>(0);
  const [salePrice, setSalePrice] = useState<number>(0);
  const [rows, setRows] = useState<CostRow[]>([]);

  // Find latest purchase rate per material (via most-recent PO date containing the item)
  const latestRateFor = (itemId: string): number => {
    let bestDate = "";
    let bestRate = 0;
    db.purchaseOrders.forEach(po => {
      const line = (po.items || []).find(x => x.itemId === itemId);
      if (line && (po.date > bestDate)) { bestDate = po.date; bestRate = line.rate || 0; }
    });
    if (bestRate === 0) {
      // fallback: current item purchase rate stored on master
      const it = db.items.find(x => x.id === itemId);
      if (it) bestRate = it.purchaseRate || 0;
    }
    return bestRate;
  };

  // Auto-fetch BOM materials whenever FG or BOM changes
  const relevantBoms = useMemo(() => {
    if (!fgId) return [] as typeof db.boms;
    const fg = db.items.find(i => i.id === fgId);
    if (!fg) return [] as typeof db.boms;
    // Match BOMs by product name (case-insensitive), fallback to any BOM
    const norm = fg.name.trim().toLowerCase();
    const matched = db.boms.filter(b => b.name.trim().toLowerCase() === norm || b.name.trim().toLowerCase().includes(norm) || norm.includes(b.name.trim().toLowerCase()));
    return matched.length > 0 ? matched : db.boms;
  }, [db.boms, db.items, fgId]);

  useEffect(() => {
    if (!fgId) return;
    const saved = persisted[fgId];
    if (saved) {
      setBomId(saved.bomId || relevantBoms[0]?.id || "");
      setLabour(saved.labourCost || 0);
      setOffice(saved.officeExpense || 0);
      setSalePrice(saved.salePrice || 0);
      setRows((saved.materialRows || []).map((r: any) => ({ ...r, rate: latestRateFor(r.itemId), amount: (Number(r.qty) || 0) * latestRateFor(r.itemId) })));
    } else {
      // Fresh — load first matching BOM
      const firstBom = relevantBoms[0];
      setBomId(firstBom?.id || "");
      setLabour(0); setOffice(0); setSalePrice(0);
      if (firstBom) {
        setRows(firstBom.materials.filter(m => m.itemId).map(m => {
          const rate = latestRateFor(m.itemId!);
          return { itemId: m.itemId!, qty: Number(m.qty) || 0, rate, amount: (Number(m.qty) || 0) * rate };
        }));
      } else {
        setRows([]);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fgId]);

  useEffect(() => {
    if (!bomId) return;
    const bom = db.boms.find(b => b.id === bomId);
    if (!bom) return;
    setRows(bom.materials.filter(m => m.itemId).map(m => {
      const rate = latestRateFor(m.itemId!);
      return { itemId: m.itemId!, qty: Number(m.qty) || 0, rate, amount: (Number(m.qty) || 0) * rate };
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bomId]);

  const materialTotal = rows.reduce((s, r) => s + r.amount, 0);
  const totalCost = materialTotal + (Number(labour) || 0) + (Number(office) || 0);
  const margin = salePrice - totalCost;
  const marginPct = totalCost > 0 ? (margin / totalCost) * 100 : 0;

  const refreshRates = () => {
    setRows(rows.map(r => {
      const rate = latestRateFor(r.itemId);
      return { ...r, rate, amount: r.qty * rate };
    }));
  };

  const saveSheet = () => {
    if (!fgId) return alert("Select a Finished Good");
    setDB(d => {
      const cur = { ...((d.settings as any).manufacturingCosts || {}) };
      cur[fgId] = {
        bomId,
        materialRows: rows,
        materialTotal,
        labourCost: Number(labour) || 0,
        officeExpense: Number(office) || 0,
        totalCost,
        salePrice: Number(salePrice) || 0,
        updatedAt: new Date().toISOString(),
        updatedBy: currentUser?.name || currentUser?.email || "User",
      };
      return { ...d, settings: { ...d.settings, manufacturingCosts: cur } as any };
    });
    log(`Manufacturing Cost saved: ${db.items.find(i => i.id === fgId)?.name} — Sale ${fmtINR(salePrice)}`, "Manufacturing Cost");
    alert("Saved. This sale price will now auto-fill in Delivery Challan for this Finished Good.");
  };

  const fg = db.items.find(i => i.id === fgId);
  const bom = db.boms.find(b => b.id === bomId);
  const savedInfo = persisted[fgId];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Manufacturing Cost</h1>
          <p className="text-sm text-slate-500">Pick a Finished Good → BOM materials auto-loaded with latest purchase rates · Fix a Sale Price that auto-fills into Delivery Challan.</p>
        </div>
      </div>

      {/* Selector */}
      <Card>
        <div className="p-3 grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <Label>Finished Good</Label>
            <Select value={fgId} onChange={(e: any) => setFgId(e.target.value)} data-testid="mfg-fg-select">
              <option value="">— Select —</option>
              {finishedGoods.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </Select>
          </div>
          <div>
            <Label>BOM</Label>
            <Select value={bomId} onChange={(e: any) => setBomId(e.target.value)} disabled={!fgId} data-testid="mfg-bom-select">
              <option value="">— Select BOM —</option>
              {(relevantBoms.length > 0 ? relevantBoms : db.boms).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </div>
          <div className="flex items-end gap-2">
            <Button variant="outline" onClick={refreshRates} disabled={!fgId || rows.length === 0} data-testid="mfg-refresh">Refresh Rates</Button>
            <Button onClick={saveSheet} disabled={!fgId} data-testid="mfg-save">Save Sheet</Button>
          </div>
        </div>
        {savedInfo && (
          <div className="px-3 pb-3 text-[11px] text-slate-500">Last saved: {new Date(savedInfo.updatedAt).toLocaleString()} by {savedInfo.updatedBy || "—"} · Sale Price {fmtINR(savedInfo.salePrice || 0)}</div>
        )}
      </Card>

      {!fgId ? (
        <Card><div className="p-6"><Empty title="Select a Finished Good" subtitle="Pick a Finished Good above to load its BOM and calculate manufacturing cost." /></div></Card>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <KPI label="Raw Material" value={fmtINR(materialTotal)} color="indigo" hint={`${rows.length} materials`} />
            <KPI label="Labour + Office" value={fmtINR((Number(labour) || 0) + (Number(office) || 0))} color="amber" />
            <KPI label="Total Cost" value={fmtINR(totalCost)} color="blue" />
            <KPI label={margin >= 0 ? "Margin" : "Loss"} value={(margin < 0 ? "-" : "") + fmtINR(Math.abs(margin))} color={margin >= 0 ? "emerald" : "rose"} hint={`${marginPct.toFixed(1)}%`} />
          </div>

          {/* Material rows */}
          <Card>
            <div className="p-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
              <div>
                <div className="font-semibold">Raw Material Cost — {fg?.name}</div>
                <div className="text-xs text-slate-500">Auto-pulled from {bom?.name || "selected BOM"}. Rates use the most recent Purchase Order date; if no PO exists the master purchase rate is used.</div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <thead>
                  <tr>
                    <Th>#</Th>
                    <Th>Material</Th>
                    <Th className="text-right">Qty</Th>
                    <Th>UOM</Th>
                    <Th className="text-right">Latest Rate</Th>
                    <Th className="text-right">Amount</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr><Td colSpan={6}><Empty title="No BOM materials" subtitle="The selected BOM has no linked items." /></Td></tr>
                  ) : rows.map((r, i) => {
                    const it = db.items.find(x => x.id === r.itemId);
                    return (
                      <tr key={r.itemId} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <Td>{i + 1}</Td>
                        <Td className="font-medium">{it?.name || "—"}
                          {r.rate === 0 && <Badge color="yellow" className="ml-2">No PO price</Badge>}
                        </Td>
                        <Td className="text-right">{r.qty}</Td>
                        <Td>{it?.unit || ""}</Td>
                        <Td className="text-right">{fmtINR(r.rate)}</Td>
                        <Td className="text-right font-semibold">{fmtINR(r.amount)}</Td>
                      </tr>
                    );
                  })}
                  {rows.length > 0 && (
                    <tr className="bg-slate-50 dark:bg-slate-800/40 font-semibold">
                      <Td colSpan={5}>Raw Material Total</Td>
                      <Td className="text-right text-indigo-700">{fmtINR(materialTotal)}</Td>
                    </tr>
                  )}
                </tbody>
              </Table>
            </div>
          </Card>

          {/* Costs */}
          <Card>
            <div className="p-3 border-b border-slate-200 dark:border-slate-800 font-semibold">Cost &amp; Sale Price</div>
            <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <div>
                  <Label>Labour Cost</Label>
                  <Input type="number" value={labour} onChange={(e: any) => setLabour(Number(e.target.value) || 0)} data-testid="mfg-labour" />
                </div>
                <div>
                  <Label>Office Expense</Label>
                  <Input type="number" value={office} onChange={(e: any) => setOffice(Number(e.target.value) || 0)} data-testid="mfg-office" />
                </div>
                <div>
                  <Label>Sale Price *</Label>
                  <Input type="number" value={salePrice} onChange={(e: any) => setSalePrice(Number(e.target.value) || 0)} className="text-lg font-semibold" data-testid="mfg-saleprice" />
                  <div className="text-[11px] text-slate-500 mt-1">This price auto-fills into Delivery Challan when the same Finished Good is picked. Users can still edit the value in the challan.</div>
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 p-4 space-y-2">
                <div className="flex justify-between text-sm"><span className="text-slate-600 dark:text-slate-400">Raw Material</span><b>{fmtINR(materialTotal)}</b></div>
                <div className="flex justify-between text-sm"><span className="text-slate-600 dark:text-slate-400">Labour</span><b>{fmtINR(Number(labour) || 0)}</b></div>
                <div className="flex justify-between text-sm"><span className="text-slate-600 dark:text-slate-400">Office Expense</span><b>{fmtINR(Number(office) || 0)}</b></div>
                <div className="border-t border-slate-200 dark:border-slate-700 pt-2 flex justify-between text-base font-bold text-indigo-700"><span>Total Cost</span><span>{fmtINR(totalCost)}</span></div>
                <div className="flex justify-between text-sm"><span className="text-slate-600 dark:text-slate-400">Sale Price</span><b>{fmtINR(Number(salePrice) || 0)}</b></div>
                <div className={"flex justify-between text-base font-bold " + (margin >= 0 ? "text-emerald-700" : "text-rose-600")}>
                  <span>{margin >= 0 ? "Margin" : "Loss"}</span>
                  <span>{margin < 0 ? "-" : ""}{fmtINR(Math.abs(margin))} <span className="text-xs">({marginPct.toFixed(1)}%)</span></span>
                </div>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
