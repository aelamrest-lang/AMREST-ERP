import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { fileDisplayUrl } from "./upload";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function fmt2(n: number | string | null | undefined): string {
  const v = Number(n);
  if (!isFinite(v)) return "0.00";
  return v.toFixed(2);
}

export function fmtINR(n: number) {
  if (isNaN(n)) return "₹0.00";
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtNum(n: number, d = 2) {
  if (isNaN(n)) return "0";
  return n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: d });
}

export function todayISO() { return new Date().toISOString().slice(0, 10); }

export function nextNumber(prefix: string, list: { number: string }[]) {
  const yr = new Date().getFullYear();
  const seq = list.filter(x => x.number.includes(`${yr}`)).length + 1;
  return `${prefix}-${yr}-${String(seq).padStart(3, "0")}`;
}

export function downloadCSV(filename: string, rows: (string | number)[][]) {
  const csv = rows.map(r => r.map(c => {
    const s = String(c ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export function calcCostingTotals(materials: { qty: number; rate: number }[], gstRate: number, marginPct: number) {
  const materialCost = materials.reduce((s, m) => s + (Number(m.qty) || 0) * (Number(m.rate) || 0), 0);
  const margin = materialCost * (marginPct / 100);
  const subTotal = materialCost + margin;
  const gstAmt = subTotal * (gstRate / 100);
  const finalPrice = subTotal + gstAmt;
  return { materialCost, margin, subTotal, gstAmt, finalPrice };
}

export function calcDocTotals(items: { qty: number; rate: number; gst: number }[]) {
  let sub = 0, gst = 0;
  for (const it of items) {
    const amt = (Number(it.qty) || 0) * (Number(it.rate) || 0);
    sub += amt;
    gst += amt * ((Number(it.gst) || 0) / 100);
  }
  return { sub, gst, total: sub + gst };
}

// Freight is distributed across line items in proportion to their amount
// so GST applies to (item amount + item's share of freight) per line.
// If sub-total is 0, freight is taxed at the weighted GST of items (or 0 if no items).
export function calcDocTotalsWithFreight(
  items: { qty: number; rate: number; gst: number }[],
  freight: number,
) {
  const fr = Number(freight) || 0;
  let sub = 0;
  const amts: number[] = [];
  for (const it of items) {
    const amt = (Number(it.qty) || 0) * (Number(it.rate) || 0);
    amts.push(amt);
    sub += amt;
  }
  let gst = 0;
  for (let i = 0; i < items.length; i++) {
    const share = sub > 0 ? (amts[i] / sub) * fr : (fr / items.length);
    const taxable = amts[i] + share;
    gst += taxable * ((Number(items[i].gst) || 0) / 100);
  }
  return { sub, freight: fr, gst, total: sub + fr + gst };
}

// A4 in points at 96 dpi = 210mm × 297mm ≈ 794 × 1123 px. We use 794 for width so
// html2canvas gives us a canvas that jsPDF can render 1:1 into an A4 page.
const A4_WIDTH_PX = 794;   // 210mm @ 96dpi
const A4_HEIGHT_PX = 1123; // 297mm @ 96dpi

export async function printArea(html: string, title = "Document") {
  // Extract inner <body> if a full HTML document is provided
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
  const inner = bodyMatch ? bodyMatch[1] : html;
  const styles = styleMatch ? styleMatch[1] : "";

  const shell = document.createElement("div");
  shell.style.position = "fixed";
  shell.style.left = "-10000px";
  shell.style.top = "0";
  shell.style.width = `${A4_WIDTH_PX}px`;
  shell.style.background = "#ffffff";
  shell.innerHTML = `<style>${styles}
    .doc { width: 100% !important; min-height: auto !important; box-shadow: none !important; margin: 0 !important; }
    body { background: #ffffff !important; }
  </style>${inner}`;
  document.body.appendChild(shell);
  try {
    const target = (shell.querySelector(".doc") as HTMLElement) || shell;
    // Detect orientation from the .doc element
    const orientation = (target.getAttribute("data-orientation") || "portrait").toLowerCase() as "portrait" | "landscape";
    if (orientation === "landscape") {
      shell.style.width = `${A4_HEIGHT_PX}px`; // 297mm landscape width
    }
    await Promise.all(Array.from(target.querySelectorAll("img")).map(img => img.complete ? Promise.resolve() : new Promise(resolve => { img.onload = resolve; img.onerror = resolve; })));
    const canvas = await html2canvas(target, { scale: 2, useCORS: true, backgroundColor: "#ffffff", logging: false });
    const fitOnePage = target.getAttribute("data-fit-one-page") === "true";
    const pageFormat = (target.getAttribute("data-page-size") || "a4").toLowerCase() as any;
    const pdf = new jsPDF({ orientation, unit: "pt", format: pageFormat });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth;
    if (fitOnePage) {
      const ratio = Math.min(pageWidth / canvas.width, pageHeight / canvas.height);
      const w = canvas.width * ratio;
      const h = canvas.height * ratio;
      pdf.addImage(canvas.toDataURL("image/png"), "PNG", (pageWidth - w) / 2, (pageHeight - h) / 2, w, h);
      pdf.save(`${title.replace(/[^a-z0-9-_]+/gi, "-")}.pdf`);
      return;
    }
    // Multi-page: slice canvas at page-height (in canvas px) increments so nothing crops
    const pageCanvasHeight = Math.floor((pageHeight * canvas.width) / pageWidth);
    const pageCanvas = document.createElement("canvas");
    const pageCtx = pageCanvas.getContext("2d")!;
    pageCanvas.width = canvas.width;
    pageCanvas.height = pageCanvasHeight;
    let rendered = 0;
    let page = 0;
    while (rendered < canvas.height) {
      const remaining = canvas.height - rendered;
      const sliceHeight = Math.min(pageCanvasHeight, remaining);
      pageCanvas.height = sliceHeight;
      pageCtx.clearRect(0, 0, pageCanvas.width, pageCanvas.height);
      pageCtx.fillStyle = "#ffffff";
      pageCtx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
      pageCtx.drawImage(canvas, 0, rendered, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);
      const imgData = pageCanvas.toDataURL("image/png");
      if (page > 0) pdf.addPage();
      const imgHeightForPage = (sliceHeight * imgWidth) / canvas.width;
      pdf.addImage(imgData, "PNG", 0, 0, imgWidth, imgHeightForPage);
      rendered += sliceHeight;
      page += 1;
    }
    pdf.save(`${title.replace(/[^a-z0-9-_]+/gi, "-")}.pdf`);
  } catch (err) {
    console.error("PDF generation failed, falling back to print", err);
    const w = window.open("", "_blank", "width=1100,height=800");
    if (w) {
      w.document.open();
      w.document.write(html.startsWith("<!doctype") || html.startsWith("<!DOCTYPE") ? html : `<!doctype html><html><head><title>${title}</title></head><body>${html}</body></html>`);
      w.document.close();
      setTimeout(() => { w.focus(); w.print(); }, 350);
    }
  } finally {
    shell.remove();
  }
}

const DOC_STYLES = `
  @page { size: A4; margin: 12mm; }
  html, body { margin: 0; padding: 0; }
  body { font-family: Arial, "Helvetica Neue", Helvetica, sans-serif; color: #111; background: #eef2f7; }
  .doc { width: 210mm; min-height: 297mm; margin: 0 auto; background: #ffffff; color: #111; box-sizing: border-box; overflow: hidden; box-shadow: 0 4px 18px rgba(15,23,42,.10); }
  .doc[data-orientation="landscape"] { width: 297mm; min-height: 210mm; }
  .doc-head { padding: 18px 20px; display: flex; justify-content: space-between; gap: 18px; align-items: flex-start; color: #ffffff; }
  .brand { display: flex; gap: 14px; align-items: center; }
  .logo { height: 58px; width: 58px; border-radius: 12px; background: #ffffff; color: #1e3a8a; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 20px; overflow: hidden; }
  .logo img { height: 100%; width: 100%; object-fit: contain; }
  .doc-title { text-align: right; }
  .doc-title h1 { font-size: 22px; letter-spacing: .06em; text-transform: uppercase; margin: 0 0 4px; }
  h1, h2, h3 { margin: 0 0 6px; }
  .doc-body { padding: 16px 20px 24px; font-size: 12px; line-height: 1.4; }
  .section-title { color: #1e3a8a; font-weight: 800; text-transform: uppercase; font-size: 12px; letter-spacing: .08em; margin: 14px 0 6px; }
  .box { border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; margin-top: 8px; background: #ffffff; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; page-break-inside: auto; }
  tr { page-break-inside: avoid; page-break-after: auto; }
  th, td { border: 1px solid #cbd5e1; padding: 6px 8px; font-size: 11.5px; text-align: left; vertical-align: top; }
  th { background: #f1f5f9; font-weight: 700; }
  .right, td.right, th.right { text-align: right; }
  .muted { color: #64748b; }
  .totals { margin-left: auto; max-width: 330px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 12px; }
  .totals div { display: flex; justify-content: space-between; margin: 4px 0; }
  .grand { border-top: 2px solid #cbd5e1; padding-top: 6px; font-size: 14px; color: #1e3a8a; font-weight: 700; }
  .badge { display: inline-block; border-radius: 999px; background: #eef2ff; color: #3730a3; padding: 3px 10px; font-weight: 700; font-size: 10px; text-transform: uppercase; }
  .signs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; margin-top: 30px; text-align: center; font-size: 11px; }
  .sign-box { border-top: 1px solid #64748b; padding-top: 6px; }
  ol { margin: 6px 0 0 22px; padding: 0; }
  ol li { margin: 3px 0; font-size: 11.5px; }
  pre { white-space: pre-wrap; font-family: inherit; font-size: 11.5px; margin: 6px 0; }
  .watermark { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; opacity: .05; font-size: 90px; font-weight: 900; transform: rotate(-30deg); }
  @media print {
    body { background: #ffffff; }
    .doc { box-shadow: none; margin: 0; }
  }
`;

function docBodyHtml(settings: any, opts: { title: string; number: string; date?: string; body: string; accent?: string; skipFormatTerms?: boolean }) {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const titleKey = normalize(opts.title);
  const format = (settings.documentFormats || []).find((f: any) => f.active && normalize(f.documentType) === titleKey)
    || (settings.documentFormats || []).find((f: any) => f.active && (titleKey.includes(normalize(f.documentType)) || normalize(f.documentType).includes(titleKey)))
    || null;
  const logoSrc = fileDisplayUrl(format?.logoUrl || settings.logoUrl);
  const logo = logoSrc
    ? `<img src="${logoSrc}" alt="Logo" crossorigin="anonymous"/>`
    : (settings.logoText || "AE");
  const companyName = format?.companyName || settings.name;
  const address = format?.address || settings.address;
  const gst = format?.gstNo || settings.gst;
  const contact = format?.contactDetails || `${settings.email} | ${settings.phone}`;
  const terms = (format?.terms || []).filter((t: any) => t.active).sort((a: any, b: any) => a.order - b.order);
  const orientation = (format?.orientation || "Portrait").toLowerCase();
  const pageSize = (format?.pageSize || "A4").toLowerCase();
  const extra = `${format?.headerContent ? `<div class="box"><b>Header Note:</b><br/>${String(format.headerContent).replace(/\n/g, "<br/>")}</div>` : ""}
    ${opts.body}
    ${!opts.skipFormatTerms && terms.length ? `<div class="box"><div class="section-title">Terms &amp; Conditions</div><ol>${terms.map((t: any) => `<li>${t.text}</li>`).join("")}</ol></div>` : ""}
    ${format?.bankDetails ? `<div class="box"><div class="section-title">Bank Details</div>${String(format.bankDetails).replace(/\n/g, "<br/>")}</div>` : ""}
    ${format?.declaration ? `<div class="box"><div class="section-title">Declaration</div>${String(format.declaration).replace(/\n/g, "<br/>")}</div>` : ""}
    ${format?.signatureName || format?.signatureUrl ? `<div style="margin-top:30px;display:flex;justify-content:flex-end"><div style="text-align:center;min-width:190px">${format.signatureUrl ? `<img src="${fileDisplayUrl(format.signatureUrl)}" crossorigin="anonymous" style="height:72px;max-width:150px;object-fit:contain;display:block;margin:0 auto 8px"/>` : `<div style="height:72px;display:flex;align-items:center;justify-content:center;color:#64748b;font-size:11px">Company Stamp</div>`}<div style="font-weight:700">${format.signatureName || "Authorized Signatory"}</div></div></div>` : ""}
    ${format?.footerContent ? `<div class="muted" style="border-top:1px solid #e2e8f0;margin-top:18px;padding-top:8px;font-size:11px">${String(format.footerContent).replace(/\n/g, "<br/>")}</div>` : ""}`;
  return `
    <div class="doc" data-fit-one-page="${format?.fitToSinglePage ? "true" : "false"}" data-page-size="${pageSize}" data-orientation="${orientation}">
      ${format?.watermark ? `<div class="watermark">${format.watermark}</div>` : ""}
      <div class="doc-head" style="background:linear-gradient(135deg,${opts.accent || "#1e3a8a"},#4f46e5)">
        <div class="brand">
          <div class="logo">${logo}</div>
          <div>
            <h2 style="font-size:20px;margin-bottom:4px">${companyName}</h2>
            <div style="font-size:11.5px;opacity:.9;max-width:470px">${address}</div>
            <div style="font-size:11.5px;opacity:.9;margin-top:3px">GST: ${gst} | ${contact}</div>
          </div>
        </div>
        <div class="doc-title">
          <h1>${opts.title}</h1>
          <div style="font-size:12px;margin-top:6px"><b>No:</b> ${opts.number}</div>
          <div style="font-size:12px"><b>Date:</b> ${opts.date || todayISO()}</div>
        </div>
      </div>
      <div class="doc-body">${format?.qrCode ? `<div style="float:right;border:5px solid #111;height:70px;width:70px;display:flex;align-items:center;justify-content:center;font-size:9px;text-align:center;margin-left:12px">QR<br/>${opts.number}</div>` : ""}${extra}</div>
    </div>
  `;
}

export function professionalDocument(settings: any, opts: { title: string; number: string; date?: string; body: string; accent?: string; skipFormatTerms?: boolean }) {
  // Self-contained HTML — usable as-is in an iframe srcDoc for WYSIWYG preview
  // AND consumed by printArea() for html2canvas → PDF export.
  return `<!doctype html><html><head><meta charset="utf-8"/><title>${opts.title}</title><style>${DOC_STYLES}</style></head><body>${docBodyHtml(settings, opts)}</body></html>`;
}
