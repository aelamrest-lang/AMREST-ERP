import { useMemo, useState } from "react";
import { useStore, uid } from "../lib/store";
import { Card, Button, Input, Select, Label, Table, Th, Td, Empty, Badge } from "../components/ui";
import type { BOM } from "../lib/types";
import { IconPlus, IconTrash, IconSearch, IconEdit, IconCheck } from "../components/icons";
import { userCan } from "../lib/permissions";

export function BOMPage() {
  const { db, setDB, log, currentUser } = useStore();
  const canCreate = userCan(currentUser, "bom", "create");
  const canEdit = userCan(currentUser, "bom", "edit");
  const canDelete = userCan(currentUser, "bom", "delete");

  const finishedProducts = useMemo(() => db.items.filter(i => i.category === "Finished Goods"), [db.items]);
  const rawAndSemiItems = useMemo(() => db.items.filter(i => i.category === "Raw Material" || i.category === "Semi-Finished"), [db.items]);

  const [selectedProductId, setSelectedProductId] = useState(finishedProducts[0]?.id || "");
  const [materialId, setMaterialId] = useState(rawAndSemiItems[0]?.id || "");
  const [materialText, setMaterialText] = useState("");
  const [qty, setQty] = useState<number>(1);
  const [registrySearch, setRegistrySearch] = useState("");
  const [materialSearch, setMaterialSearch] = useState("");
  const [saveMessage, setSaveMessage] = useState("");

  const selectedProduct = finishedProducts.find(i => i.id === selectedProductId) || finishedProducts[0];
  const currentBom = useMemo(() => {
    if (!selectedProduct) return undefined;
    return db.boms.find(b => b.productItemId === selectedProduct.id) || db.boms.find(b => b.name === selectedProduct.name);
  }, [db.boms, selectedProduct]);

  const filteredMaterials = useMemo(() => {
    const term = (materialSearch || materialText).toLowerCase();
    return rawAndSemiItems.filter(i =>
      !term || i.name.toLowerCase().includes(term) || i.code.toLowerCase().includes(term) || i.category.toLowerCase().includes(term)
    );
  }, [rawAndSemiItems, materialSearch, materialText]);

  const registryProducts = useMemo(() => {
    const term = registrySearch.toLowerCase();
    return finishedProducts.filter(i => !term || i.name.toLowerCase().includes(term) || i.code.toLowerCase().includes(term));
  }, [finishedProducts, registrySearch]);

  const selectMaterial = (id: string) => {
    const item = rawAndSemiItems.find(i => i.id === id);
    setMaterialId(id);
    setMaterialText(item ? item.name : "");
  };

  const typeMaterial = (value: string) => {
    setMaterialText(value);
    const exact = rawAndSemiItems.find(i => i.name.toLowerCase() === value.toLowerCase() || i.code.toLowerCase() === value.toLowerCase());
    if (exact) setMaterialId(exact.id);
  };

  const mapConsumable = () => {
    if (!selectedProduct) return alert("Select a finished product model first.");
    const item = rawAndSemiItems.find(i => i.id === materialId) || rawAndSemiItems.find(i => i.name.toLowerCase() === materialText.toLowerCase() || i.code.toLowerCase() === materialText.toLowerCase());
    if (!item) return alert("Select or type a valid raw/semi-finished material.");
    if (!qty || qty <= 0) return alert("Enter required consumption quantity.");

    setDB(d => {
      const existing = d.boms.find(b => b.productItemId === selectedProduct.id) || d.boms.find(b => b.name === selectedProduct.name);
      const mapped = { itemId: item.id, name: item.name, qty, unit: item.unit };
      if (existing) {
        return {
          ...d,
          boms: d.boms.map(b => b.id === existing.id ? {
            ...b,
            productItemId: selectedProduct.id,
            name: selectedProduct.name,
            materials: [...b.materials.filter(m => m.itemId !== item.id), mapped],
          } : b),
        };
      }
      const newBom: BOM = {
        id: uid(),
        name: selectedProduct.name,
        productItemId: selectedProduct.id,
        kva: extractKva(selectedProduct.name),
        materials: [mapped],
        createdAt: new Date().toISOString(),
      };
      return { ...d, boms: [newBom, ...d.boms] };
    });
    log(`Mapped ${item.name} to BOM ${selectedProduct.name}`, "BOM");
    setQty(1);
    setMaterialText("");
  };

  const removeMapped = (itemId?: string) => {
    if (!currentBom || !itemId) return;
    if (!confirm("Remove this material from BOM mapping?")) return;
    setDB(d => ({
      ...d,
      boms: d.boms.map(b => b.id === currentBom.id ? { ...b, materials: b.materials.filter(m => m.itemId !== itemId) } : b),
    }));
    log(`Removed material from BOM ${currentBom.name}`, "BOM");
  };

  const updateQty = (itemId: string | undefined, value: number) => {
    if (!currentBom || !itemId) return;
    setDB(d => ({
      ...d,
      boms: d.boms.map(b => b.id === currentBom.id ? {
        ...b,
        materials: b.materials.map(m => m.itemId === itemId ? { ...m, qty: value } : m),
      } : b),
    }));
  };

  const saveCurrentBom = () => {
    if (!selectedProduct) return alert("Select a finished product model first.");
    const now = new Date().toISOString();
    setDB(d => {
      const existing = d.boms.find(b => b.productItemId === selectedProduct.id) || d.boms.find(b => b.name === selectedProduct.name);
      if (existing) {
        return {
          ...d,
          boms: d.boms.map(b => b.id === existing.id ? {
            ...b,
            productItemId: selectedProduct.id,
            name: selectedProduct.name,
            kva: b.kva || extractKva(selectedProduct.name),
            createdAt: now,
          } : b),
        };
      }
      const newBom: BOM = {
        id: uid(),
        name: selectedProduct.name,
        productItemId: selectedProduct.id,
        kva: extractKva(selectedProduct.name),
        materials: [],
        createdAt: now,
      };
      return { ...d, boms: [newBom, ...d.boms] };
    });
    log(`Saved BOM ${selectedProduct.name}`, "BOM");
    setSaveMessage("BOM saved successfully.");
    setTimeout(() => setSaveMessage(""), 2500);
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Bill of Materials (BOM) Mapping Engine</h1>
        <p className="text-sm text-slate-500">Define, edit, and revision-track the raw material consumption map per unit of transformer model built.</p>
      </div>

      <div className="grid xl:grid-cols-[1fr_420px] gap-5">
        <Card>
          <div className="p-5 space-y-5">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <h3 className="font-semibold text-lg">Configure BOM Blueprint Map</h3>
                <p className="text-xs text-slate-500 mt-1">Finished products are selected as BOM models. Only Raw Materials and Semi-Finished items can be mapped as consumables.</p>
              </div>
              <div className="flex items-center gap-2">
                {saveMessage && <span className="text-xs font-medium text-emerald-600">{saveMessage}</span>}
                {(canCreate || canEdit) && <Button onClick={saveCurrentBom}><IconCheck size={14}/> Save BOM</Button>}
              </div>
            </div>

            <div>
              <Label>Select Transformer Model</Label>
              <Select value={selectedProduct?.id || ""} onChange={(e: any) => setSelectedProductId(e.target.value)}>
                {finishedProducts.map(p => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
              </Select>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 p-4">
              <h4 className="font-semibold mb-3">Add / Map Consumable Material</h4>
              <div className="grid md:grid-cols-[1.2fr_1fr_0.7fr_auto] gap-3 items-end">
                <div>
                  <Label>Type Raw / Semi-Finished Material</Label>
                  <Input
                    value={materialText}
                    list="bom-material-type-options"
                    placeholder="Type material name or code..."
                    onChange={(e: any) => typeMaterial(e.target.value)}
                  />
                  <datalist id="bom-material-type-options">
                    {rawAndSemiItems.map(i => <option key={`${i.id}-name`} value={i.name}>{i.code} - {i.category}</option>)}
                    {rawAndSemiItems.map(i => <option key={`${i.id}-code`} value={i.code}>{i.name} - {i.category}</option>)}
                  </datalist>
                </div>
                <div>
                  <Label>Select Raw / Semi-Finished Material</Label>
                  <Select value={materialId} onChange={(e: any) => selectMaterial(e.target.value)}>
                    <option value="">Choose material...</option>
                    {filteredMaterials.map(i => <option key={i.id} value={i.id}>{i.name} ({i.category})</option>)}
                  </Select>
                </div>
                <div>
                  <Label>Consumption Qty (Per Unit)</Label>
                  <Input type="number" value={qty} min={0} step="0.001" placeholder="e.g. 180" onChange={(e: any) => setQty(Number(e.target.value))} />
                </div>
                <Button disabled={!canCreate && !canEdit} onClick={mapConsumable}><IconPlus size={14}/> Map Consumable</Button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Input className="max-w-sm" value={materialSearch} onChange={(e: any) => setMaterialSearch(e.target.value)} placeholder="Filter material dropdown..." />
                <Badge color="blue">Raw Materials</Badge>
                <Badge color="yellow">Semi-Finished</Badge>
              </div>
            </div>

            <div>
              <h4 className="font-semibold mb-3">Current BOM Map Items</h4>
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                <Table>
                  <thead><tr><Th>Material Details</Th><Th>UOM</Th><Th>Required Qty (Per Unit)</Th><Th>Action</Th></tr></thead>
                  <tbody>
                    {(currentBom?.materials || []).map(m => {
                      const item = rawAndSemiItems.find(i => i.id === m.itemId);
                      return (
                        <tr key={m.itemId || m.name} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <Td>
                            <div className="font-semibold">{item?.name || m.name}</div>
                            <div className="text-xs text-slate-500">{item?.code || "Custom"}</div>
                            {item && <Badge color={item.category === "Raw Material" ? "blue" : "yellow"}>{item.category}</Badge>}
                          </Td>
                          <Td>{m.unit}</Td>
                          <Td>{canEdit ? <Input className="max-w-32" type="number" value={m.qty} step="0.001" onChange={(e: any) => updateQty(m.itemId, Number(e.target.value))} /> : <span className="font-semibold">{m.qty}</span>}</Td>
                          <Td>{canDelete && <Button size="sm" variant="ghost" onClick={() => removeMapped(m.itemId)}><IconTrash size={14}/></Button>}</Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
                {(!currentBom || currentBom.materials.length === 0) && <Empty title="No materials mapped" subtitle="Select or type a raw/semi material and click Map Consumable" />}
              </div>
              <div className="mt-4 flex items-center justify-end gap-2">
                {saveMessage && <span className="text-xs font-medium text-emerald-600">{saveMessage}</span>}
                {(canCreate || canEdit) && <Button onClick={saveCurrentBom}><IconCheck size={14}/> Save BOM</Button>}
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <div className="p-5 border-b border-slate-100 dark:border-slate-800">
            <h3 className="font-semibold text-lg">Transformer Model Registry</h3>
            <div className="relative mt-3">
              <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input className="pl-9" value={registrySearch} onChange={(e: any) => setRegistrySearch(e.target.value)} placeholder="Search model type name..." />
            </div>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[720px] overflow-y-auto">
            {registryProducts.map(product => {
              const bom = db.boms.find(b => b.productItemId === product.id) || db.boms.find(b => b.name === product.name);
              return (
                <button key={product.id} className="w-full text-left p-5 hover:bg-slate-50 dark:hover:bg-slate-800/50" onClick={() => setSelectedProductId(product.id)}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-slate-800 dark:text-slate-100">{product.name}</div>
                      <div className="text-xs text-slate-500 mt-1">{product.code} | {product.category}</div>
                    </div>
                    <Badge color={selectedProductId === product.id ? "indigo" : "slate"}>Rev {bom ? "1." + Math.max(0, bom.materials.length) : "0.0"}</Badge>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2 text-sm text-slate-600 dark:text-slate-300">
                    <div>Mapped Materials: <span className="font-semibold">{bom?.materials.length || 0}</span></div>
                    <div>Updated: <span className="font-semibold">{bom?.createdAt?.slice(0, 10) || "-"}</span></div>
                  </div>
                  <div className="text-indigo-600 dark:text-indigo-300 font-medium text-sm mt-3 flex items-center gap-1"><IconEdit size={13}/> Configure/Edit BOM Mapping</div>
                </button>
              );
            })}
            {registryProducts.length === 0 && <Empty title="No finished products found" />}
          </div>
        </Card>
      </div>
    </div>
  );
}

function extractKva(name: string) {
  return name.match(/\d+\s*KVA/i)?.[0]?.replace(/\s+/g, " ") || "";
}