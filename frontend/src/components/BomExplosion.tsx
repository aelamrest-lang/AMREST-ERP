import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { useStore } from "../lib/store";
import { explodeBom } from "../lib/bomTree";
import { Button, Input, Label, Table, Th, Td, Badge, Empty } from "./ui";
import { IconDownload } from "./icons";
import { fmt2 } from "../lib/utils";

const catColor = (c: string) => c === "Raw Material" ? "blue" : c === "Finished Goods" ? "green" : "yellow";

export function BomExplosion({ productId, productName }: { productId: string; productName: string }) {
  const { db } = useStore();
  const [qty, setQty] = useState(1);
  const { rows, cycles, depth } = useMemo(() => explodeBom(db, productId, qty || 0), [db.boms, db.items, productId, qty]); // eslint-disable-line react-hooks/exhaustive-deps

  const exportXlsx = () => {
    const data = rows.map((r, i) => ({ "Sr. No.": i + 1, Material: r.name, Category: r.category, UOM: r.unit, [`Total Required Qty (for ${qty})`]: r.qty, "From BOM of": [...r.via].join(", ") }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), "Total Requirement");
    XLSX.writeFile(wb, `${productName.replace(/[^a-z0-9-_ ]/gi, "_")} - Multi-Level Requirement.xlsx`);
  };

  return (
    <div className="rounded-xl border border-indigo-200 dark:border-indigo-900 p-4 space-y-3" data-testid="bom-explosion">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h4 className="font-semibold">Multi-Level Total Requirement</h4>
          <p className="text-xs text-slate-500">All levels combined (FG → FG → SFG / Raw Material). Levels deep: <b data-testid="bom-explosion-depth">{depth}</b></p>
        </div>
        <div className="flex items-end gap-2">
          <div><Label>Quantity to build</Label><Input type="number" min={0} step="1" className="!w-32" value={qty} onChange={(e: any) => setQty(Number(e.target.value))} data-testid="bom-explosion-qty"/></div>
          <Button variant="outline" disabled={!rows.length} onClick={exportXlsx} data-testid="bom-explosion-export"><IconDownload size={14}/> Excel</Button>
        </div>
      </div>
      {cycles.length > 0 && <div className="rounded-lg bg-rose-50 text-rose-700 px-3 py-2 text-xs" data-testid="bom-explosion-cycle">Circular reference skipped: {cycles.join(" | ")}</div>}
      <div className="max-h-96 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <Table>
          <thead><tr><Th>Sr.</Th><Th>Material</Th><Th>UOM</Th><Th>Total Required Qty</Th><Th>From BOM of</Th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.itemId} data-testid={`bom-explosion-row-${r.itemId}`}>
                <Td className="font-mono text-xs text-slate-500">{i + 1}</Td>
                <Td><div className="font-semibold">{r.name}</div><Badge color={catColor(r.category)}>{r.category}</Badge></Td>
                <Td>{r.unit}</Td>
                <Td className="font-semibold" data-testid={`bom-explosion-qty-${r.itemId}`}>{fmt2(r.qty)}</Td>
                <Td className="text-xs text-slate-500">{[...r.via].join(", ")}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {rows.length === 0 && <Empty title="No components yet" subtitle="Map components to see the total requirement" />}
      </div>
    </div>
  );
}
