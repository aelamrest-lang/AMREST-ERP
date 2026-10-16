import type { DeliveryChallan, DispatchRecord, JobCard, ProductionEntry } from "./types";

export const jobCardReadyQty = (jc: JobCard, entries: ProductionEntry[]) => {
  if (jc.status === "Completed") return jc.qty;
  const dr = entries.filter(e => e.jobCardId === jc.id && e.stage === "Dispatch Ready").reduce((s, e) => s + (Number(e.todayQty) || 0), 0);
  return Math.min(jc.qty, dr);
};
export const jcDispatched = (challans: DeliveryChallan[], jcId: string) =>
  challans.filter(c => c.jobCardId === jcId).reduce((s, c) => s + dispatchedQty(c), 0);
export const lineValue = (qty: number, rate: number, gst: number) => qty * rate * (1 + (gst || 0) / 100);

export const invDispatches = (c: DeliveryChallan): DispatchRecord[] => c.dispatches || [];
export const invoicedQty = (c: DeliveryChallan) => (c.items || []).reduce((s, i) => s + (Number(i.qty) || 0), 0);
export const dispatchedQty = (c: DeliveryChallan) =>
  invDispatches(c).flatMap(d => d.lines).reduce((s, l) => s + (Number(l.qty) || 0), 0);
export const dispatchedOfLine = (c: DeliveryChallan, name: string) =>
  invDispatches(c).flatMap(d => d.lines).filter(l => l.name === name).reduce((s, l) => s + (Number(l.qty) || 0), 0);

// Records created before the invoice/dispatch split were physical dispatches — treat them as fully dispatched.
export function legacyDispatch(c: DeliveryChallan): DispatchRecord {
  return {
    id: `legacy-${c.id}`, number: c.number, date: c.date, legacy: true,
    lines: (c.items || []).map(i => ({ itemId: i.itemId, name: i.name, qty: i.qty, deducted: c.dispatchType ? i.qty : 0 })),
    vehicle: c.vehicle, driver: c.driver, transport: c.transport, acknowledged: !!c.acknowledged, createdAt: c.createdAt,
  };
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
function words(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) return `${TENS[Math.floor(n / 10)]} ${ONES[n % 10]}`.trim();
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} Hundred ${words(n % 100)}`.trim();
  if (n < 100000) return `${words(Math.floor(n / 1000))} Thousand ${words(n % 1000)}`.trim();
  if (n < 10000000) return `${words(Math.floor(n / 100000))} Lakh ${words(n % 100000)}`.trim();
  return `${words(Math.floor(n / 10000000))} Crore ${words(n % 10000000)}`.trim();
}
export function inrWords(amount: number) {
  const r = Math.floor(amount);
  const p = Math.round((amount - r) * 100);
  return `Rupees ${words(r) || "Zero"}${p ? ` and ${words(p)} Paise` : ""} Only`;
}

export function nextSeqNumber(prefix: string, numbers: string[]) {
  const head = `${prefix}-${new Date().getFullYear()}-`;
  const max = numbers.filter(n => n.startsWith(head)).reduce((m, n) => Math.max(m, Number(n.slice(head.length)) || 0), 0);
  return `${head}${String(max + 1).padStart(3, "0")}`;
}

const norm = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
export function matchSoItem<T extends { name: string }>(items: T[], product: string): T | undefined {
  return items.find(i => i.name === product) || items.find(i => norm(i.name) === norm(product)) || (items.length === 1 ? items[0] : undefined);
}
