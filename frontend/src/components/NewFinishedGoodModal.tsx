import { useEffect, useState } from "react";
import { Modal, Input, Select, Label, Button } from "./ui";
import { useStore, uid } from "../lib/store";
import type { Item } from "../lib/types";

const UNIT_OPTIONS = ["Nos", "Kg", "Ltr", "Mtr", "Pcs", "Sets", "Sheets", "Roll", "Bag", "Box"];
const GST_OPTIONS = [0, 5, 12, 18, 28];

interface Props {
  open: boolean;
  onClose: () => void;
  seedName?: string;
  onCreated: (item: Item) => void;
  testIdPrefix?: string;
}

/**
 * Small inline modal that quickly creates a Finished Good in the Item Master.
 * Used from Sales Orders, Quotations, and Proformas so sales users don't have
 * to leave the document to add a missing product.
 */
export function NewFinishedGoodModal({ open, onClose, seedName = "", onCreated, testIdPrefix = "new-fg" }: Props) {
  const { setDB, log } = useStore();
  const [name, setName] = useState(seedName);
  const [unit, setUnit] = useState("Nos");
  const [gstRate, setGstRate] = useState(18);
  const [hsn, setHsn] = useState("");
  const [saleRate, setSaleRate] = useState(0);
  const [purchaseRate, setPurchaseRate] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setName(seedName);
      setUnit("Nos");
      setGstRate(18);
      setHsn("");
      setSaleRate(0);
      setPurchaseRate(0);
      setError("");
    }
  }, [open, seedName]);

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) { setError("Product name is required"); return; }
    const item: Item = {
      id: uid(),
      name: trimmed,
      category: "Finished Goods",
      unit,
      hsn: hsn.trim() || undefined,
      gstRate: Number(gstRate) || 0,
      openingStock: 0,
      currentStock: 0,
      minStock: 0,
      reorderLevel: 0,
      purchaseRate: Number(purchaseRate) || 0,
      saleRate: Number(saleRate) || 0,
    };
    setDB(d => ({ ...d, items: [item, ...d.items] }));
    log(`Created finished good "${item.name}" (inline)`, "Items");
    onCreated(item);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Quick Add · New Finished Good" size="md">
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <Label>Product Name *</Label>
          <Input value={name} onChange={(e: any) => setName(e.target.value)} data-testid={`${testIdPrefix}-name`} autoFocus />
        </div>
        <div>
          <Label>Unit</Label>
          <Select value={unit} onChange={(e: any) => setUnit(e.target.value)} data-testid={`${testIdPrefix}-unit`}>
            {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
          </Select>
        </div>
        <div>
          <Label>GST %</Label>
          <Select value={gstRate} onChange={(e: any) => setGstRate(Number(e.target.value) || 0)} data-testid={`${testIdPrefix}-gst`}>
            {GST_OPTIONS.map(g => <option key={g} value={g}>{g}%</option>)}
          </Select>
        </div>
        <div>
          <Label>HSN Code</Label>
          <Input value={hsn} onChange={(e: any) => setHsn(e.target.value)} placeholder="Optional" data-testid={`${testIdPrefix}-hsn`} />
        </div>
        <div>
          <Label>Sale Rate (₹)</Label>
          <Input type="number" value={saleRate} onChange={(e: any) => setSaleRate(Number(e.target.value) || 0)} data-testid={`${testIdPrefix}-sale-rate`} />
        </div>
        <div className="sm:col-span-2">
          <Label>Purchase Rate (₹) — optional</Label>
          <Input type="number" value={purchaseRate} onChange={(e: any) => setPurchaseRate(Number(e.target.value) || 0)} data-testid={`${testIdPrefix}-purchase-rate`} />
        </div>
      </div>
      {error && <div className="mt-2 text-sm text-rose-600">{error}</div>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={save} data-testid={`${testIdPrefix}-save`}>Create &amp; Use</Button>
      </div>
    </Modal>
  );
}
