import type { DB, DeliveryChallan, DispatchRecord } from "./types";
import { calcDocTotalsWithFreight, fmtINR, printArea, professionalDocument } from "./utils";
import { dispatchedOfLine, inrWords } from "./invoice";

const partyBox = (title: string, cust: any) =>
  `<div class="box"><div class="section-title">${title}</div><b>${cust?.name || ""}</b><br/>${cust?.address || ""}${cust?.city ? `, ${cust.city}` : ""}${cust?.state ? `, ${cust.state}` : ""}<br/>GSTIN: ${cust?.gst || "-"}<br/>Contact: ${cust?.mobile || "-"}</div>`;

export function invoiceHtml(db: DB, c: DeliveryChallan) {
  const so = db.salesOrders.find(s => s.id === c.salesOrderId);
  const jc = db.jobCards.find(j => j.id === c.jobCardId);
  const cust = db.parties.find(p => p.id === c.customerId);
  const items = c.items || [];
  const t = calcDocTotalsWithFreight(items, Number(c.freight) || 0);
  const intra = !cust?.gst || !db.settings.gst || cust.gst.slice(0, 2) === db.settings.gst.slice(0, 2);
  const rows = items.map((i, idx) => {
    const it = db.items.find(x => x.id === i.itemId) || db.items.find(x => x.name === i.name);
    const taxable = i.qty * i.rate;
    const g = taxable * (i.gst || 0) / 100;
    return `<tr><td>${idx + 1}</td><td>${i.name}</td><td>${i.hsn || it?.hsn || "-"}</td><td class="right">${i.qty}</td><td>${it?.unit || "Nos"}</td><td class="right">${fmtINR(i.rate)}</td><td class="right">${fmtINR(taxable)}</td><td class="right">${i.gst}%</td><td class="right">${fmtINR(g)}</td><td class="right">${fmtINR(taxable + g)}</td></tr>`;
  }).join("");
  const taxRows = intra
    ? `<tr><td>CGST</td><td class="right">${fmtINR(t.gst / 2)}</td></tr><tr><td>SGST</td><td class="right">${fmtINR(t.gst / 2)}</td></tr>`
    : `<tr><td>IGST</td><td class="right">${fmtINR(t.gst)}</td></tr>`;
  const dispatched = items.reduce((s, i) => s + dispatchedOfLine(c, i.name), 0);
  const total = items.reduce((s, i) => s + i.qty, 0);
  const body = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      ${partyBox("Bill To / Consignee", cust)}
      <div class="box"><div class="section-title">Invoice Details</div><b>Invoice No:</b> ${c.number}<br/><b>Invoice Date:</b> ${c.date}<br/>${so ? `<b>Sales Order:</b> ${so.number} (${so.date})<br/>` : ""}${jc ? `<b>Job Card:</b> ${jc.number}<br/>` : ""}${c.dispatchType ? `<b>Supply Type:</b> ${c.dispatchType}<br/>` : ""}<b>Place of Supply:</b> ${intra ? "Intra-state" : "Inter-state"}<br/><b>Dispatch Status:</b> ${dispatched >= total ? "Dispatched" : dispatched > 0 ? `Partially Dispatched (${dispatched}/${total})` : "Not Dispatched"}</div>
    </div>
    <table>
      <thead><tr><th>#</th><th>Description</th><th>HSN</th><th class="right">Qty</th><th>Unit</th><th class="right">Rate</th><th class="right">Taxable</th><th class="right">GST%</th><th class="right">GST Amt</th><th class="right">Amount</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <table style="margin-top:8px;max-width:340px;margin-left:auto">
      <tr><td>Taxable Value</td><td class="right">${fmtINR(t.sub)}</td></tr>
      <tr><td>Freight</td><td class="right">${fmtINR(t.freight)}</td></tr>
      ${taxRows}
      <tr><td><b>Grand Total</b></td><td class="right"><b>${fmtINR(t.total)}</b></td></tr>
    </table>
    <div class="box" style="margin-top:8px"><b>Amount in words:</b> ${inrWords(t.total)}</div>
    <div class="signs"><div class="sign-box">Customer Signature</div><div class="sign-box">Prepared By</div><div class="sign-box">Authorized Signatory</div></div>`;
  return professionalDocument(db.settings, { title: "Sales Invoice", number: c.number, date: c.date, body, accent: "#0f766e" });
}

export const printInvoice = (db: DB, c: DeliveryChallan) => printArea(invoiceHtml(db, c), c.number);

export function printDispatchNote(db: DB, c: DeliveryChallan, d: DispatchRecord) {
  const cust = db.parties.find(p => p.id === c.customerId);
  const rows = d.lines.map((l, idx) => {
    const it = db.items.find(x => x.id === l.itemId) || db.items.find(x => x.name === l.name);
    return `<tr><td>${idx + 1}</td><td>${l.name}</td><td class="right"><b>${l.qty}</b></td><td>${it?.unit || "Nos"}</td></tr>`;
  }).join("");
  const body = `
    ${partyBox("Consignee", cust)}
    <div class="box"><div class="section-title">Dispatch Details</div><b>Against Sales Invoice:</b> ${c.number} (${c.date})<br/><b>Vehicle:</b> ${d.vehicle || "-"} | <b>Driver:</b> ${d.driver || "-"}<br/><b>Transport / LR:</b> ${d.transport || "-"}<br/><b>Acknowledgement:</b> ${d.acknowledged ? "Received" : "Pending"}</div>
    <table><thead><tr><th>#</th><th>Item</th><th class="right">Qty Dispatched</th><th>Unit</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="signs"><div class="sign-box">Receiver Signature</div><div class="sign-box">Dispatch</div><div class="sign-box">Authorized Signatory</div></div>`;
  printArea(professionalDocument(db.settings, { title: "Dispatch Note", number: d.number, date: d.date, body, accent: "#0f766e" }), d.number);
}
