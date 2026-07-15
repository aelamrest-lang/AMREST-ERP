import { useEffect, useMemo, useState } from "react";
import { useStore, uid } from "../lib/store";
import { Badge, Button, Card, Empty, Input, KPI, Select, Td, Th } from "../components/ui";
import type { DB, JobCard, QCFinalReportAttachment, QCFormat, QCTestRecord, SerialRecord } from "../lib/types";
import { IconCheck, IconDownload, IconFactory, IconPrint, IconRefresh } from "../components/icons";
import { downloadCSV, printArea, professionalDocument, todayISO } from "../lib/utils";
import { userCan } from "../lib/permissions";

const DTR_GROUPS = [
  { title: "No Load Losses (Watts) and Currents (Amp)", ids: ["nllFreq", "nllVoltage", "nllCurrent100", "nllMeasuredWatts"] },
  { title: "Load Losses at 50% (A=     )", ids: ["ll50Freq", "ll50Voltage", "ll50AppliedCurrent", "ll50MeasuredLossAmb", "ll50TotalLoss"] },
  { title: "Load Losses at 100% (A=     )", ids: ["ll100Freq", "ll100ImpVoltage", "ll100AppliedCurrent", "ll100MeasuredLossAmb", "ll100TotalLoss"] },
];

const CTPT_BURDEN_10 = ["120%", "20%", "5%", "1%"];
const CTPT_BURDEN_25 = ["120%", "20%", "5%", "1%"];
const CTPT_ACC_30 = ["120%", "80%"];
const CTPT_ACC_75 = ["120%", "80%"];
const PHASES = ["A", "B", "C"];
const CT_BURDEN_10 = ["120%", "20%", "5%", "1%"];
const CT_BURDEN_25 = ["120%", "20%", "5%", "1%"];
const PT_CONNECTIONS = ["A-B", "A-C", "B-C"];
const PT_PERCENTAGES = ["120 %", "80 %"];

function formatForJob(job: JobCard | undefined, db: DB) {
  return db.qcFormats.find(f => f.id === job?.qcFormatId) || db.qcFormats[0];
}

function isDtr(format?: QCFormat) {
  return format?.id === "qcf-dtr" || format?.name.toLowerCase().includes("dtr");
}

function isCtPt(format?: QCFormat) {
  return format?.id === "qcf-oil" || !!format?.name.toLowerCase().includes("ct pt");
}

function isCtRoutine(format?: QCFormat) {
  return format?.id === "qcf-ct" || !!format?.name.toLowerCase().includes("ct routine");
}

function QCInput({ value, disabled, row, col, className = "min-w-24", onCommit }: { value: string; disabled?: boolean; row: number; col: string; className?: string; onCommit: (value: string) => void }) {
  const [local, setLocal] = useState(value || "");

  useEffect(() => setLocal(value || ""), [value]);

  const commit = () => {
    if ((value || "") !== local) onCommit(local);
  };

  const focusNext = (direction: "next" | "down" | "up") => {
    const current = document.activeElement as HTMLElement | null;
    if (!current) return;
    if (direction === "next") {
      const cells = Array.from(document.querySelectorAll<HTMLElement>("[data-qc-cell='true']"));
      const idx = cells.indexOf(current);
      cells[idx + 1]?.focus();
      return;
    }
    const targetRow = direction === "down" ? row + 1 : row - 1;
    document.querySelector<HTMLElement>(`[data-qc-row='${targetRow}'][data-qc-col='${col}']`)?.focus();
  };

  return (
    <Input
      className={`qc-cell ${className}`}
      value={local}
      disabled={disabled}
      data-qc-cell="true"
      data-qc-row={row}
      data-qc-col={col}
      onChange={(e: any) => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e: any) => {
        if (e.key === "Enter") { e.preventDefault(); commit(); focusNext("next"); }
        if (e.key === "ArrowDown") { e.preventDefault(); commit(); focusNext("down"); }
        if (e.key === "ArrowUp") { e.preventDefault(); commit(); focusNext("up"); }
      }}
    />
  );
}

function nextSerial(start: string, index: number) {
  const match = start.match(/^(.*?)(\d+)$/);
  if (!match) return index === 0 ? start : `${start}-${index + 1}`;
  const prefix = match[1];
  const num = match[2];
  return `${prefix}${String(Number(num) + index).padStart(num.length, "0")}`;
}

function isPtRoutine(format?: QCFormat) {
  return format?.id === "qcf-pt" || !!format?.name.toLowerCase().includes("pt routine");
}

function generateRows(job: JobCard, db: DB) {
  const format = formatForJob(job, db);
  if (!format) return { serials: [] as SerialRecord[], tests: [] as QCTestRecord[] };
  const existing = db.qcTests.filter(t => t.jobCardId === job.id).length;
  const so = db.salesOrders.find(s => s.id === job.salesOrderId);
  const serials: SerialRecord[] = [];
  const tests: QCTestRecord[] = [];

  for (let i = existing; i < job.qty; i++) {
    const existingSerial = db.serials.filter(s => s.jobCardId === job.id)[i]?.serialNo;
    const serialNo = existingSerial || (job.serialStart ? nextSerial(job.serialStart, i) : `DTR25${String(db.serials.length + i + 1).padStart(4, "0")}`);
    if (!db.serials.some(s => s.serialNo === serialNo) && !serials.some(s => s.serialNo === serialNo)) {
      serials.push({
        id: uid(), serialNo, jobCardId: job.id, productName: job.product,
        productionStatus: "Pending", qcStatus: "Pending", dispatchStatus: "Pending",
        reworkStatus: "None", customerId: so?.customerId, warrantyStatus: "Pending",
        createdAt: new Date().toISOString(),
      });
    }
    tests.push({
      id: uid(), jobCardId: job.id, serialNo, srNo: i + 1, uniqueNo: serialNo,
      polarity: "OK", hvTitle: "HV Winding Resistance (Ohm)", hvAmbientTemp: 30,
      hvAB: "", hvBC: "", hvCA: "", lvTitle: "LV Winding Resistance (m-ohm)",
      lvAB: "", lvBC: "", lvCA: "", ratioR: "", ratioY: "", ratioB: "",
      irHVE: "", irLVE: "", irHVLV: "", dvdfVolt: "", hvKv: "", lvKv: "",
      result: "Pending", workflowStatus: "Testing Entry", testingEngineer: "",
      dateOfTesting: todayISO(), qcFormatId: format.id,
      dynamicValues: Object.fromEntries(format.columns.map(c => [c.id, ""])),
    });
  }
  return { serials, tests };
}

export function TestingPage() {
  const { db, setDB, currentUser, log } = useStore();
  const canEdit = userCan(currentUser, "testing", "edit");
  const canApprove = userCan(currentUser, "testing", "approve");
  const canPrint = userCan(currentUser, "testing", "print");
  const canExport = userCan(currentUser, "testing", "export");
  const [jobId, setJobId] = useState(db.jobCards[0]?.id || "");
  const [search, setSearch] = useState("");
  const [formatFilter, setFormatFilter] = useState("");

  useEffect(() => {
    if (!jobId && db.jobCards[0]) setJobId(db.jobCards[0].id);
  }, [db.jobCards.length, jobId]);

  useEffect(() => {
    const missing = db.jobCards.filter(job => db.qcFormats.length && db.qcTests.filter(t => t.jobCardId === job.id).length < job.qty);
    if (!missing.length) return;
    setDB(d => {
      const generated = missing.reduce((acc, job) => {
        const fixedJob = job.qcFormatId ? job : { ...job, qcFormatId: d.qcFormats[0]?.id };
        const rows = generateRows(fixedJob, d);
        acc.serials.push(...rows.serials);
        acc.tests.push(...rows.tests);
        return acc;
      }, { serials: [] as SerialRecord[], tests: [] as QCTestRecord[] });

      return {
        ...d,
        jobCards: d.jobCards.map(job => !job.qcFormatId && d.qcFormats[0] ? { ...job, qcFormatId: d.qcFormats[0].id } : job),
        serials: [...d.serials, ...generated.serials],
        qcTests: [...d.qcTests, ...generated.tests],
      };
    });
  }, [db.jobCards.length, db.qcFormats.length, db.qcTests.length]);

  const selectedJob = db.jobCards.find(j => j.id === jobId) || db.jobCards[0];
  const selectedFormat = formatForJob(selectedJob, db);
  const tests = useMemo(() => db.qcTests
    .filter(t => !selectedJob || t.jobCardId === selectedJob.id)
    .filter(t => !formatFilter || t.qcFormatId === formatFilter)
    .filter(t => !search || `${t.serialNo} ${t.uniqueNo} ${t.result} ${t.testingEngineer} ${t.dateOfTesting}`.toLowerCase().includes(search.toLowerCase())),
    [db.qcTests, selectedJob, formatFilter, search]);

  const assignFormatToJob = (formatId: string) => {
    if (!selectedJob) return;
    setDB(d => ({
      ...d,
      jobCards: d.jobCards.map(j => j.id === selectedJob.id ? { ...j, qcFormatId: formatId } : j),
      qcTests: d.qcTests.filter(t => t.jobCardId !== selectedJob.id),
    }));
    log(`QC format assigned to ${selectedJob.number}`, "QC Testing");
  };

  const updateTest = (id: string, patch: Partial<QCTestRecord>) => {
    setDB(d => {
      const old = d.qcTests.find(t => t.id === id);
      let items = d.items;
      let serials = d.serials;
      if (old && patch.result && (patch.result === "Fail" || patch.result === "Hold") && !old.returnedToInventory) {
        const job = d.jobCards.find(j => j.id === old.jobCardId);
        if (job) items = d.items.map(item => {
          const reserved = job.reservedItems.find(r => r.itemId === item.id);
          return reserved ? { ...item, currentStock: item.currentStock + reserved.qty / Math.max(1, job.qty) } : item;
        });
      }
      if (old && patch.result) {
        serials = d.serials.map(s => s.serialNo === old.serialNo
          ? { ...s, qcStatus: patch.result!, reworkStatus: patch.result === "Fail" ? "Scrap" : patch.result === "Hold" ? "Rework" : "None", dispatchStatus: patch.result === "Pass" ? "Ready" : "Pending" }
          : s);
      }
      return { ...d, items, serials, qcTests: d.qcTests.map(t => t.id === id ? { ...t, ...patch, returnedToInventory: patch.result === "Fail" || patch.result === "Hold" ? true : t.returnedToInventory } : t) };
    });
    log("QC test updated", "QC Testing");
    if (patch.result === "Pass") setTimeout(() => printRoutine("Routine Test Result Sheet"), 250);
  };

  const updateDynamic = (id: string, key: string, value: string) => {
    const test = db.qcTests.find(t => t.id === id);
    updateTest(id, { dynamicValues: { ...(test?.dynamicValues || {}), [key]: value } });
  };

  const updateUniqueNo = (id: string, value: string) => {
    const duplicate = db.qcTests.some(t => t.id !== id && t.uniqueNo.trim().toLowerCase() === value.trim().toLowerCase());
    if (duplicate) return alert("Duplicate unique number is not allowed.");
    const oldSerial = db.qcTests.find(t => t.id === id)?.serialNo;
    setDB(d => ({
      ...d,
      qcTests: d.qcTests.map(t => t.id === id ? { ...t, uniqueNo: value, serialNo: value } : t),
      serials: d.serials.map(s => s.serialNo === oldSerial ? { ...s, serialNo: value } : s),
    }));
    log("QC unique number updated", "QC Testing");
  };

  const counts = {
    pending: db.qcTests.filter(t => t.result === "Pending").length,
    tested: db.qcTests.filter(t => t.result !== "Pending").length,
    pass: db.qcTests.filter(t => t.result === "Pass").length,
    fail: db.qcTests.filter(t => t.result === "Fail").length,
    hold: db.qcTests.filter(t => t.result === "Hold").length,
  };
  const formatSummary = db.qcFormats.map(f => ({ format: f, count: db.qcTests.filter(t => t.qcFormatId === f.id).length }));
  const engineerSummary = Array.from(new Set(db.qcTests.map(t => t.testingEngineer).filter(Boolean))).map(name => ({ name, count: db.qcTests.filter(t => t.testingEngineer === name).length }));

  const printRoutine = (kind: "Routine Test Result Sheet" | "Inspection Certificate" | "Dispatch Clearance") => {
    if (!selectedJob || !selectedFormat) return;
    const body = isDtr(selectedFormat) ? dtrPdf(selectedFormat, tests, selectedJob.number) : isCtPt(selectedFormat) ? ctPtPdf(tests, selectedJob.number) : isCtRoutine(selectedFormat) ? ctPdf(tests, selectedJob.number) : isPtRoutine(selectedFormat) ? ptPdf(tests, selectedJob.number) : genericPdf(selectedFormat, tests, selectedJob.number);
    printArea(professionalDocument(db.settings, { title: kind, number: `${kind.substring(0, 3).toUpperCase()}-${selectedJob.number}`, date: todayISO(), body, accent: "#1d4ed8" }), `${kind}-${selectedJob.number}`);
  };

  const exportExcel = () => downloadCSV("qc-testing-report.csv", [["Job Card", "QC Format", "Serial", "Result", "Engineer", "Workflow"], ...db.qcTests.map(t => [db.jobCards.find(j => j.id === t.jobCardId)?.number || "", db.qcFormats.find(f => f.id === t.qcFormatId)?.name || "", t.serialNo, t.result, t.testingEngineer, t.workflowStatus])]);

  const finalReports = db.qcFinalReports.filter(r => r.jobCardId === selectedJob?.id);

  const attachFinalReport = (file?: File) => {
    if (!file || !selectedJob || !currentUser) return;
    const allowed = [
      "image/jpeg", "image/png", "application/pdf",
      "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "text/csv"
    ];
    const allowedExt = /\.(jpg|jpeg|png|pdf|xls|xlsx|csv)$/i.test(file.name);
    if (!allowed.includes(file.type) && !allowedExt) return alert("Only PDF, JPG, PNG, and Excel files are allowed.");
    const reader = new FileReader();
    reader.onload = () => {
      const attachment: QCFinalReportAttachment = {
        id: uid(),
        jobCardId: selectedJob.id,
        fileName: file.name,
        fileType: file.type || "application/octet-stream",
        fileUrl: String(reader.result || ""),
        uploadedBy: currentUser.id,
        uploadedAt: new Date().toISOString(),
      };
      setDB(d => ({
        ...d,
        qcFinalReports: [attachment, ...(d.qcFinalReports || [])],
      }));
      log(`Attached QC final report ${file.name} to ${selectedJob.number}`, "QC Testing");
    };
    reader.readAsDataURL(file);
  };

  const openAttachment = (attachment: QCFinalReportAttachment) => {
    const win = window.open();
    if (!win) return;
    if (attachment.fileType === "application/pdf") {
      win.document.write(`<iframe src="${attachment.fileUrl}" style="border:0;width:100%;height:100vh"></iframe>`);
    } else if (attachment.fileType.startsWith("image/") || /\.(jpg|jpeg|png)$/i.test(attachment.fileName)) {
      win.document.write(`<img src="${attachment.fileUrl}" style="max-width:100%;height:auto;display:block;margin:auto"/>`);
    } else {
      win.document.write(`<a href="${attachment.fileUrl}" download="${attachment.fileName}" style="font-family:Arial;padding:24px;display:block">Download ${attachment.fileName}</a>`);
    }
  };

  const removeAttachment = (id: string) => {
    if (!confirm("Remove this QC final report attachment?")) return;
    setDB(d => ({ ...d, qcFinalReports: (d.qcFinalReports || []).filter(r => r.id !== id) }));
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between gap-3 flex-wrap">
        <div><h1 className="text-2xl font-bold">QC Testing Module</h1><p className="text-sm text-slate-500">Auto-generated testing boxes/rows from Job Card quantity</p></div>
        <div className="flex gap-2 flex-wrap">
          <label className="inline-flex items-center justify-center gap-1.5 rounded-lg font-medium px-3.5 py-2 text-sm border border-slate-300 dark:border-slate-700 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200">
            Attach QC Routine Test Final Report
            <input type="file" accept=".jpg,.jpeg,.png,.pdf,.xls,.xlsx,.csv,image/jpeg,image/png,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" className="hidden" onChange={(e) => { attachFinalReport(e.target.files?.[0]); e.currentTarget.value = ""; }} />
          </label>
          {canPrint && <Button variant="outline" onClick={() => printRoutine("Routine Test Result Sheet")}><IconPrint size={14}/> Routine Test PDF</Button>}{canPrint && <Button variant="outline" onClick={() => printRoutine("Inspection Certificate")}><IconPrint size={14}/> Inspection Certificate</Button>}{canPrint && <Button variant="outline" onClick={() => printRoutine("Dispatch Clearance")}><IconPrint size={14}/> Dispatch Clearance</Button>}{canExport && <Button variant="outline" onClick={exportExcel}><IconDownload size={14}/> Excel</Button>}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4"><KPI label="Pending QC" value={String(counts.pending)} color="amber" icon={<IconRefresh size={22}/>}/><KPI label="Tested Qty" value={String(counts.tested)} color="indigo" icon={<IconFactory size={22}/>}/><KPI label="Pass Qty" value={String(counts.pass)} color="emerald" icon={<IconCheck size={22}/>}/><KPI label="Fail Qty" value={String(counts.fail)} color="rose" icon={<IconFactory size={22}/>}/><KPI label="Hold Qty" value={String(counts.hold)} color="amber" icon={<IconFactory size={22}/>}/></div>

      <div className="grid lg:grid-cols-3 gap-4"><Card><div className="p-4"><h3 className="font-semibold mb-2">QC Format Wise Testing</h3>{formatSummary.map(x => <div key={x.format.id} className="flex justify-between text-sm border-b border-slate-100 dark:border-slate-800 py-1"><span>{x.format.name}</span><Badge color="indigo">{x.count}</Badge></div>)}</div></Card><Card><div className="p-4"><h3 className="font-semibold mb-2">Pass/Fail Summary</h3><div className="space-y-1 text-sm"><div className="flex justify-between"><span>Pass</span><b>{counts.pass}</b></div><div className="flex justify-between"><span>Fail</span><b>{counts.fail}</b></div><div className="flex justify-between"><span>Hold/Rework</span><b>{counts.hold}</b></div></div></div></Card><Card><div className="p-4"><h3 className="font-semibold mb-2">Engineer Wise Testing</h3>{engineerSummary.length ? engineerSummary.map(e => <div key={e.name} className="flex justify-between text-sm border-b border-slate-100 dark:border-slate-800 py-1"><span>{e.name}</span><b>{e.count}</b></div>) : <Empty title="No data" />}</div></Card></div>

      <Card>
        <div className="p-4 flex gap-3 flex-wrap border-b border-slate-100 dark:border-slate-800"><Select className="w-80" value={selectedJob?.id || ""} onChange={(e:any)=>setJobId(e.target.value)}>{db.jobCards.map(j => <option key={j.id} value={j.id}>{j.number} - {j.product} - {formatForJob(j, db)?.name || "No QC Format"}</option>)}</Select><Select className="w-72" value={selectedJob?.qcFormatId || selectedFormat?.id || ""} onChange={(e:any)=>assignFormatToJob(e.target.value)}>{db.qcFormats.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</Select><Select className="w-60" value={formatFilter} onChange={(e:any)=>setFormatFilter(e.target.value)}><option value="">All QC Formats</option>{db.qcFormats.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</Select><Input className="flex-1 min-w-56" value={search} onChange={(e:any)=>setSearch(e.target.value)} placeholder="Search serial, engineer, result..." /></div>
        <div className="p-4 text-sm text-slate-500">Active Format: <b>{selectedFormat?.name || "Not Assigned"}</b> | Rows: <b>{tests.length}</b> / Job Qty: <b>{selectedJob?.qty || 0}</b></div>
        {finalReports.length > 0 && <div className="px-4 pb-4 flex flex-wrap gap-2">{finalReports.map(report => <span key={report.id} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs"><button className="font-semibold text-indigo-500" onClick={() => openAttachment(report)}>{report.fileName}</button><button className="text-rose-500" onClick={() => removeAttachment(report.id)}>Remove</button></span>)}</div>}
        {selectedFormat && isDtr(selectedFormat) ? <DtrTable tests={tests} format={selectedFormat} canEdit={canEdit} canApprove={canApprove} updateTest={updateTest} updateDynamic={updateDynamic} updateUniqueNo={updateUniqueNo} /> : selectedFormat && isCtPt(selectedFormat) ? <CtPtTable tests={tests} canEdit={canEdit} canApprove={canApprove} updateTest={updateTest} updateDynamic={updateDynamic} updateUniqueNo={updateUniqueNo} /> : selectedFormat && isCtRoutine(selectedFormat) ? <CtRoutineTable tests={tests} canEdit={canEdit} canApprove={canApprove} updateTest={updateTest} updateDynamic={updateDynamic} updateUniqueNo={updateUniqueNo} /> : selectedFormat && isPtRoutine(selectedFormat) ? <PtRoutineTable tests={tests} canEdit={canEdit} canApprove={canApprove} updateTest={updateTest} updateDynamic={updateDynamic} updateUniqueNo={updateUniqueNo} /> : <GenericTable tests={tests} format={selectedFormat} canEdit={canEdit} canApprove={canApprove} updateTest={updateTest} updateDynamic={updateDynamic} updateUniqueNo={updateUniqueNo} />}
        {tests.length === 0 && <Empty title="No QC rows" subtitle="Rows auto-generate from job card quantity" />}
      </Card>
    </div>
  );
}

function DtrHeader({ format }: { format: QCFormat }) {
  const col = (id: string) => format.columns.find(c => c.id === id)?.name || id;
  return <thead><tr><Th rowSpan={2}>Sr No.</Th><Th rowSpan={2}>UNIQUE NO</Th><Th rowSpan={2}>Amb. Temp in Deg. C</Th>{DTR_GROUPS.map(g => <Th key={g.title} colSpan={g.ids.length} className="text-center">{g.title}</Th>)}<Th rowSpan={2}>Separate Source test at 28 kV for HV Side for 60 Sec.</Th><Th rowSpan={2}>Separate Source test at 3 kV for LV Side for 60 Sec.</Th><Th rowSpan={2}>DVDF test at 866 Volts from LV Side at 100 Hz for 60 Sec.</Th><Th rowSpan={2}>Result</Th><Th rowSpan={2}>Workflow</Th></tr><tr>{DTR_GROUPS.flatMap(g => g.ids.map(id => <Th key={id}>{col(id)}</Th>))}</tr></thead>;
}

function DtrTable({ tests, format, canEdit, canApprove, updateTest, updateDynamic, updateUniqueNo }: any) {
  const input = (t: QCTestRecord, id: string) => <QCInput className="min-w-24" value={t.dynamicValues?.[id] || ""} disabled={!canEdit} row={tests.findIndex((x: QCTestRecord) => x.id === t.id)} col={id} onCommit={(value) => updateDynamic(t.id, id, value)} />;
  return <div className="overflow-x-auto"><table className="min-w-[1900px] text-sm"><DtrHeader format={format}/><tbody>{tests.map((t: QCTestRecord, rowIndex: number) => <tr key={t.id}><Td>{t.srNo}</Td><Td><QCInput className="min-w-28 font-mono text-xs" value={t.uniqueNo} disabled={!canEdit} row={rowIndex} col="uniqueNo" onCommit={(value) => updateUniqueNo(t.id, value)}/></Td><Td>{input(t,"ambTemp")}</Td>{DTR_GROUPS.flatMap(g => g.ids.map(id => <Td key={id}>{input(t,id)}</Td>))}<Td>{input(t,"source28kv")}</Td><Td>{input(t,"source3kv")}</Td><Td>{input(t,"dvdf866")}</Td><Td><Select value={t.result} disabled={!canEdit} onChange={(e:any)=>updateTest(t.id,{result:e.target.value})}><option>Pending</option><option>Pass</option><option>Fail</option><option>Hold</option></Select></Td><Td><Select value={t.workflowStatus} disabled={!canApprove} onChange={(e:any)=>updateTest(t.id,{workflowStatus:e.target.value})}><option>Testing Entry</option><option>QC Verification</option><option>QC Approval</option><option>Final Approval</option><option>Ready For Dispatch</option></Select><QCInput className="mt-1 min-w-28" value={t.testingEngineer} disabled={!canEdit} row={rowIndex} col="engineer" onCommit={(value) => updateTest(t.id,{testingEngineer:value})}/></Td></tr>)}</tbody></table></div>;
}

function GenericTable({ tests, format, canEdit, canApprove, updateTest, updateDynamic }: any) {
  return <table className="min-w-full text-sm"><thead><tr><Th>Sr No</Th><Th>Serial / Unique No</Th>{(format?.columns || []).map((c: any) => <Th key={c.id}>{c.name}</Th>)}<Th>Result</Th><Th>Workflow</Th></tr></thead><tbody>{tests.map((t: QCTestRecord, rowIndex: number) => <tr key={t.id}><Td>{t.srNo}</Td><Td>{t.uniqueNo}</Td>{(format?.columns || []).map((c: any) => <Td key={c.id}><QCInput value={t.dynamicValues?.[c.id] || ""} disabled={!canEdit} row={rowIndex} col={c.id} onCommit={(value) => updateDynamic(t.id, c.id, value)}/></Td>)}<Td><Select value={t.result} disabled={!canEdit} onChange={(e:any)=>updateTest(t.id,{result:e.target.value})}><option>Pending</option><option>Pass</option><option>Fail</option><option>Hold</option></Select></Td><Td><Select value={t.workflowStatus} disabled={!canApprove} onChange={(e:any)=>updateTest(t.id,{workflowStatus:e.target.value})}><option>Testing Entry</option><option>QC Verification</option><option>QC Approval</option><option>Final Approval</option><option>Ready For Dispatch</option></Select><QCInput className="mt-1 min-w-28" value={t.testingEngineer} disabled={!canEdit} row={rowIndex} col="engineer" onCommit={(value) => updateTest(t.id,{testingEngineer:value})}/></Td></tr>)}</tbody></table>;
}

function CtPtTable({ tests, canEdit, canApprove, updateTest, updateDynamic }: any) {
  const input = (t: QCTestRecord, id: string, cls = "min-w-20") => <QCInput className={cls} value={t.dynamicValues?.[id] || ""} disabled={!canEdit} row={tests.findIndex((x: QCTestRecord) => x.id === t.id)} col={id} onCommit={(value) => updateDynamic(t.id, id, value)} />;
  const phaseRow = (t: QCTestRecord, phase: string, idx: number) => {
    const conn = phase === "A" ? "A-B" : phase === "B" ? "A-C" : "B-C";
    return <tr key={`${t.id}-${phase}`}>
      {idx === 0 && <Td rowSpan={3}>{t.srNo}</Td>}
      {idx === 0 && <Td rowSpan={3}><div className="font-mono text-xs">{t.uniqueNo}</div><Input className="mt-1" value={t.dynamicValues?.ctType || "CTR : 92/AEL/"} disabled={!canEdit} onChange={(e:any)=>updateDynamic(t.id,"ctType",e.target.value)} /></Td>}
      {idx === 0 && <Td rowSpan={3}>{input(t,"polarity","min-w-16")}</Td>}
      {idx === 0 && <Td rowSpan={3}>{input(t,"sepHv","min-w-16")}</Td>}
      {idx === 0 && <Td rowSpan={3}>{input(t,"sepLv","min-w-16")}</Td>}
      {idx === 0 && <Td rowSpan={3}>{input(t,"dvdf","min-w-16")}</Td>}
      {idx === 0 && <Td rowSpan={3}>{input(t,"ir","min-w-20")}</Td>}
      <Td className="text-center font-semibold">{phase}</Td>
      {CTPT_BURDEN_10.map(p => <Td key={`b10-${p}`}>{input(t,`b10_${phase}_${p}`)}</Td>)}
      {CTPT_BURDEN_25.map(p => <Td key={`b25-${p}`}>{input(t,`b25_${phase}_${p}`)}</Td>)}
      <Td className="text-center font-semibold">{conn}</Td>
      {CTPT_ACC_30.map(p => <Td key={`a30-${p}`}>{input(t,`a30_${conn}_${p}`)}</Td>)}
      {CTPT_ACC_75.map(p => <Td key={`a75-${p}`}>{input(t,`a75_${conn}_${p}`)}</Td>)}
      {idx === 0 && <Td rowSpan={3}><Select value={t.result} disabled={!canEdit} onChange={(e:any)=>updateTest(t.id,{result:e.target.value})}><option>Pending</option><option>Pass</option><option>Fail</option><option>Hold</option></Select></Td>}
      {idx === 0 && <Td rowSpan={3}>{input(t,"remarks","min-w-28")}<Select className="mt-1" value={t.workflowStatus} disabled={!canApprove} onChange={(e:any)=>updateTest(t.id,{workflowStatus:e.target.value})}><option>Testing Entry</option><option>QC Verification</option><option>QC Approval</option><option>Final Approval</option><option>Ready For Dispatch</option></Select><Input className="mt-1" placeholder="Engineer" value={t.testingEngineer} disabled={!canEdit} onChange={(e:any)=>updateTest(t.id,{testingEngineer:e.target.value})}/></Td>}
    </tr>;
  };
  return <div className="overflow-x-auto"><table className="min-w-[2200px] text-xs"><thead><tr><Th colSpan={25} className="text-center font-bold">ROUTINE TEST RESULT SHEET</Th></tr><tr><Th colSpan={4}>Type : 11 kV CT PT Oil Cooled</Th><Th colSpan={4}>Class / VA : 0.5s / 10 VA</Th><Th colSpan={5}>I.L : 12/28/75 kVp</Th><Th colSpan={7}>Testing Engineer Name</Th><Th colSpan={5}>Date of Test</Th></tr><tr><Th rowSpan={3}>Sr. No.</Th><Th rowSpan={3}>CTR / UNIQUE NO</Th><Th rowSpan={3}>Polarity</Th><Th rowSpan={3}>Separate source test at HV Side for 60 sec.</Th><Th rowSpan={3}>Separate source test at LV Side for 60 sec.</Th><Th rowSpan={3}>Induced Over Voltage (DVDF)</Th><Th rowSpan={3}>Insulation Resistance</Th><Th rowSpan={3}>Connection/Phase</Th><Th colSpan={4}>Burden : 10 VA<br/>Ratio Error & Phase Angle Error</Th><Th colSpan={4}>Burden : 2.5 VA<br/>Ratio Error & Phase Angle Error</Th><Th rowSpan={3}>Connection/Phase</Th><Th colSpan={4}>Accuracy Class : 0.2</Th><Th rowSpan={3}>Conforms / Does not Conforms</Th><Th rowSpan={3}>Remarks if Any</Th></tr><tr><Th colSpan={4}></Th><Th colSpan={4}></Th><Th colSpan={2}>Burden : 30 VA</Th><Th colSpan={2}>Burden : 7.5 VA</Th></tr><tr>{CTPT_BURDEN_10.map(x=><Th key={`h10-${x}`}>{x}</Th>)}{CTPT_BURDEN_25.map(x=><Th key={`h25-${x}`}>{x}</Th>)}{CTPT_ACC_30.map(x=><Th key={`h30-${x}`}>{x}</Th>)}{CTPT_ACC_75.map(x=><Th key={`h75-${x}`}>{x}</Th>)}</tr></thead><tbody>{tests.flatMap((t: QCTestRecord) => PHASES.map((p, i) => phaseRow(t, p, i)))}</tbody></table></div>;
}

function CtRoutineTable({ tests, canEdit, canApprove, updateTest, updateDynamic }: any) {
  const input = (t: QCTestRecord, id: string, cls = "min-w-20") => <QCInput className={cls} value={t.dynamicValues?.[id] || ""} disabled={!canEdit} row={tests.findIndex((x: QCTestRecord) => x.id === t.id)} col={id} onCommit={(value) => updateDynamic(t.id, id, value)} />;
  return <div className="overflow-x-auto"><table className="min-w-[1500px] text-xs"><thead><tr><Th colSpan={16} className="text-center font-bold">ROUTINE TEST RESULT SHEET</Th><Th colSpan={2}>Date of Test :</Th></tr><tr><Th colSpan={5}>Type : 11 kV Resin Cast CTs (for Cubicle)</Th><Th colSpan={3}>Class / VA : 0.5s/10 VA</Th><Th colSpan={4}>I.L : 12/28/75 kVP</Th><Th colSpan={6}>Testing Engineer Name :</Th></tr><tr><Th rowSpan={3}>Sr. No.</Th><Th rowSpan={3}>CTR</Th><Th rowSpan={3}>UNIQUE NO</Th><Th rowSpan={3}>Polarity</Th><Th rowSpan={3}>Separate source test at HV Side for 60 sec.</Th><Th rowSpan={3}>Separate source test at LV Side for 60 sec.</Th><Th rowSpan={3}>Insulation Resistance</Th><Th colSpan={4}>Burden : 10 VA<br/>Ratio Error & Phase Angle Error</Th><Th colSpan={4}>Burden : 2.5 VA<br/>Ratio Error & Phase Angle Error</Th><Th rowSpan={3}>Result</Th><Th rowSpan={3}>Workflow</Th></tr><tr><Th colSpan={4}></Th><Th colSpan={4}></Th></tr><tr>{CT_BURDEN_10.map(x => <Th key={`ct10-${x}`}>{x}</Th>)}{CT_BURDEN_25.map(x => <Th key={`ct25-${x}`}>{x}</Th>)}</tr></thead><tbody>{tests.map((t: QCTestRecord) => <tr key={t.id}><Td>{t.srNo}</Td><Td>{input(t,"ctr","min-w-24")}</Td><Td className="font-mono text-xs">{t.uniqueNo}</Td><Td>{input(t,"polarity","min-w-16")}</Td><Td>{input(t,"sepHv")}</Td><Td>{input(t,"sepLv")}</Td><Td>{input(t,"ir")}</Td>{CT_BURDEN_10.map(p => <Td key={`b10-${p}`}>{input(t,`b10_${p}`)}</Td>)}{CT_BURDEN_25.map(p => <Td key={`b25-${p}`}>{input(t,`b25_${p}`)}</Td>)}<Td><Select value={t.result} disabled={!canEdit} onChange={(e:any)=>updateTest(t.id,{result:e.target.value})}><option>Pending</option><option>Pass</option><option>Fail</option><option>Hold</option></Select></Td><Td><Select value={t.workflowStatus} disabled={!canApprove} onChange={(e:any)=>updateTest(t.id,{workflowStatus:e.target.value})}><option>Testing Entry</option><option>QC Verification</option><option>QC Approval</option><option>Final Approval</option><option>Ready For Dispatch</option></Select><Input className="mt-1" placeholder="Engineer" value={t.testingEngineer} disabled={!canEdit} onChange={(e:any)=>updateTest(t.id,{testingEngineer:e.target.value})}/></Td></tr>)}</tbody></table></div>;
}

function PtRoutineTable({ tests, canEdit, canApprove, updateTest, updateDynamic }: any) {
  const input = (t: QCTestRecord, id: string, cls = "min-w-20") => <QCInput className={cls} value={t.dynamicValues?.[id] || ""} disabled={!canEdit} row={tests.findIndex((x: QCTestRecord) => x.id === t.id)} col={id} onCommit={(value) => updateDynamic(t.id, id, value)} />;
  const row = (t: QCTestRecord, conn: string, pct: string, idx: number) => <tr key={`${t.id}-${conn}-${pct}`}>{idx===0&&<Td rowSpan={6}>{t.srNo}</Td>}{idx===0&&<Td rowSpan={6} className="font-mono text-xs">{t.uniqueNo}</Td>}{idx===0&&<Td rowSpan={6}>{input(t,"polarity","min-w-16")}</Td>}{idx===0&&<Td rowSpan={6}>{input(t,"sepLv03")}</Td>}{idx===0&&<Td rowSpan={6}>{input(t,"dvdf")}</Td>}{idx===0&&<Td rowSpan={6}>{input(t,"sepHv")}</Td>}{idx===0&&<Td rowSpan={6}>{input(t,"ir")}</Td>}<Td className="font-semibold text-center">{conn}</Td><Td>{pct}</Td><Td>{input(t,`${conn}_${pct}_ratio25`)}</Td><Td>{input(t,`${conn}_${pct}_phase25`)}</Td><Td>{input(t,`${conn}_${pct}_ratio625`)}</Td><Td>{input(t,`${conn}_${pct}_phase625`)}</Td>{idx===0&&<Td rowSpan={6}><Select value={t.result} disabled={!canEdit} onChange={(e:any)=>updateTest(t.id,{result:e.target.value})}><option>Pending</option><option>Pass</option><option>Fail</option><option>Hold</option></Select></Td>}{idx===0&&<Td rowSpan={6}>{input(t,"remarks","min-w-28")}<Select className="mt-1" value={t.workflowStatus} disabled={!canApprove} onChange={(e:any)=>updateTest(t.id,{workflowStatus:e.target.value})}><option>Testing Entry</option><option>QC Verification</option><option>QC Approval</option><option>Final Approval</option><option>Ready For Dispatch</option></Select><Input className="mt-1" placeholder="Engineer" value={t.testingEngineer} disabled={!canEdit} onChange={(e:any)=>updateTest(t.id,{testingEngineer:e.target.value})}/></Td>}</tr>;
  return <div className="overflow-x-auto"><table className="min-w-[1700px] text-xs"><thead><tr><Th colSpan={15} className="text-center font-bold">ROUTINE TEST RESULT SHEET</Th></tr><tr><Th colSpan={4}>Type : 11 KV Resin Cast PT-3Ph</Th><Th colSpan={3}>I.L : 12/28/75 kVP</Th><Th colSpan={5}>Testing Engineer Name :</Th><Th colSpan={3}></Th></tr><tr><Th rowSpan={3}>Sr. No.</Th><Th rowSpan={3}>UNIQUE NO</Th><Th rowSpan={3}>Polarity</Th><Th rowSpan={3}>Separate source test at 03 KV for LV Side for 60 sec.</Th><Th rowSpan={3}>Induced Over Voltage (DVDF)</Th><Th rowSpan={3}>Separate source test at for HV Side for 60 sec</Th><Th rowSpan={3}>Insulation Resistance</Th><Th rowSpan={3}></Th><Th colSpan={5}>Accuracy Class : 0.5</Th><Th rowSpan={3}>Conforms / Does not Conforms</Th><Th rowSpan={3}>Remarks if Any</Th></tr><tr><Th colSpan={3}>Burden : 25 VA</Th><Th colSpan={2}>Burden : 6.25 VA</Th></tr><tr><Th>Percentage</Th><Th>Ratio Error</Th><Th>Phase Error</Th><Th>Ratio Error</Th><Th>Phase Error</Th></tr></thead><tbody>{tests.flatMap((t: QCTestRecord) => PT_CONNECTIONS.flatMap(conn => PT_PERCENTAGES.map((pct, i) => row(t, conn, pct, PT_CONNECTIONS.indexOf(conn)*2+i))))}</tbody></table></div>;
}

function dtrPdf(format: QCFormat, tests: QCTestRecord[], jobNumber: string) {
  const sub = (id: string) => `<th>${format.columns.find(c => c.id === id)?.name || id}</th>`;
  return `<table style="font-size:9px"><thead><tr><th rowspan="2">Sr No.</th><th rowspan="2">UNIQUE NO</th><th rowspan="2">Amb. Temp in Deg. C</th>${DTR_GROUPS.map(g => `<th colspan="${g.ids.length}">${g.title}</th>`).join("")}<th rowspan="2">Separate Source test at 28 kV for HV Side for 60 Sec.</th><th rowspan="2">Separate Source test at 3 kV for LV Side for 60 Sec.</th><th rowspan="2">DVDF test at 866 Volts from LV Side at 100 Hz for 60 Sec.</th><th rowspan="2">Result</th></tr><tr>${DTR_GROUPS.flatMap(g => g.ids.map(sub)).join("")}</tr></thead><tbody>${tests.map(t => `<tr><td>${t.srNo}</td><td>${t.uniqueNo}</td><td>${t.dynamicValues?.ambTemp || ""}</td>${DTR_GROUPS.flatMap(g => g.ids.map(id => `<td>${t.dynamicValues?.[id] || ""}</td>`)).join("")}<td>${t.dynamicValues?.source28kv || ""}</td><td>${t.dynamicValues?.source3kv || ""}</td><td>${t.dynamicValues?.dvdf866 || ""}</td><td>${t.result}</td></tr>`).join("")}</tbody></table>${footer(jobNumber)}`;
}

function genericPdf(format: QCFormat, tests: QCTestRecord[], jobNumber: string) {
  return `<table><thead><tr><th>Sr</th><th>Unique No</th>${format.columns.map(c => `<th>${c.name}</th>`).join("")}<th>Result</th><th>Engineer</th></tr></thead><tbody>${tests.map(t => `<tr><td>${t.srNo}</td><td>${t.uniqueNo}</td>${format.columns.map(c => `<td>${t.dynamicValues?.[c.id] || ""}</td>`).join("")}<td>${t.result}</td><td>${t.testingEngineer}</td></tr>`).join("")}</tbody></table>${footer(jobNumber)}`;
}

function ctPtPdf(tests: QCTestRecord[], jobNumber: string) {
  const row = (t: QCTestRecord, phase: string, idx: number) => {
    const conn = phase === "A" ? "A-B" : phase === "B" ? "A-C" : "B-C";
    return `<tr>${idx===0?`<td rowspan="3">${t.srNo}</td><td rowspan="3">${t.uniqueNo}<br/>${t.dynamicValues?.ctType || "CTR : 92/AEL/"}</td><td rowspan="3">${t.dynamicValues?.polarity || ""}</td><td rowspan="3">${t.dynamicValues?.sepHv || ""}</td><td rowspan="3">${t.dynamicValues?.sepLv || ""}</td><td rowspan="3">${t.dynamicValues?.dvdf || ""}</td><td rowspan="3">${t.dynamicValues?.ir || ""}</td>`:""}<td>${phase}</td>${CTPT_BURDEN_10.map(p=>`<td>${t.dynamicValues?.[`b10_${phase}_${p}`]||""}</td>`).join("")}${CTPT_BURDEN_25.map(p=>`<td>${t.dynamicValues?.[`b25_${phase}_${p}`]||""}</td>`).join("")}<td>${conn}</td>${CTPT_ACC_30.map(p=>`<td>${t.dynamicValues?.[`a30_${conn}_${p}`]||""}</td>`).join("")}${CTPT_ACC_75.map(p=>`<td>${t.dynamicValues?.[`a75_${conn}_${p}`]||""}</td>`).join("")}${idx===0?`<td rowspan="3">${t.result}</td><td rowspan="3">${t.dynamicValues?.remarks || ""}</td>`:""}</tr>`;
  };
  return `<table style="font-size:8px"><thead><tr><th colspan="25">ROUTINE TEST RESULT SHEET</th></tr><tr><th colspan="4">Type : 11 kV CT PT Oil Cooled</th><th colspan="4">Class / VA : 0.5s / 10 VA</th><th colspan="5">I.L : 12/28/75 kVp</th><th colspan="7">Testing Engineer Name</th><th colspan="5">Date of Test</th></tr><tr><th rowspan="3">Sr. No.</th><th rowspan="3">CTR / UNIQUE NO</th><th rowspan="3">Polarity</th><th rowspan="3">HV 60 sec.</th><th rowspan="3">LV 60 sec.</th><th rowspan="3">DVDF</th><th rowspan="3">IR</th><th rowspan="3">Connection/Phase</th><th colspan="4">Burden : 10 VA</th><th colspan="4">Burden : 2.5 VA</th><th rowspan="3">Connection/Phase</th><th colspan="4">Accuracy Class : 0.2</th><th rowspan="3">Conforms</th><th rowspan="3">Remarks</th></tr><tr><th colspan="4"></th><th colspan="4"></th><th colspan="2">Burden : 30 VA</th><th colspan="2">Burden : 7.5 VA</th></tr><tr>${CTPT_BURDEN_10.map(x=>`<th>${x}</th>`).join("")}${CTPT_BURDEN_25.map(x=>`<th>${x}</th>`).join("")}${CTPT_ACC_30.map(x=>`<th>${x}</th>`).join("")}${CTPT_ACC_75.map(x=>`<th>${x}</th>`).join("")}</tr></thead><tbody>${tests.flatMap(t => PHASES.map((p,i)=>row(t,p,i))).join("")}</tbody></table>${footer(jobNumber)}`;
}

function ctPdf(tests: QCTestRecord[], jobNumber: string) {
  return `<table style="font-size:8px"><thead><tr><th colspan="16">ROUTINE TEST RESULT SHEET</th><th colspan="2">Date of Test :</th></tr><tr><th colspan="5">Type : 11 kV Resin Cast CTs (for Cubicle)</th><th colspan="3">Class / VA : 0.5s/10 VA</th><th colspan="4">I.L : 12/28/75 kVP</th><th colspan="6">Testing Engineer Name :</th></tr><tr><th rowspan="3">Sr. No.</th><th rowspan="3">CTR</th><th rowspan="3">UNIQUE NO</th><th rowspan="3">Polarity</th><th rowspan="3">HV Side 60 sec.</th><th rowspan="3">LV Side 60 sec.</th><th rowspan="3">IR</th><th colspan="4">Burden : 10 VA<br/>Ratio Error & Phase Angle Error</th><th colspan="4">Burden : 2.5 VA<br/>Ratio Error & Phase Angle Error</th><th rowspan="3">Result</th><th rowspan="3">Workflow</th></tr><tr><th colspan="4"></th><th colspan="4"></th></tr><tr>${CT_BURDEN_10.map(x=>`<th>${x}</th>`).join("")}${CT_BURDEN_25.map(x=>`<th>${x}</th>`).join("")}</tr></thead><tbody>${tests.map(t => `<tr><td>${t.srNo}</td><td>${t.dynamicValues?.ctr || ""}</td><td>${t.uniqueNo}</td><td>${t.dynamicValues?.polarity || ""}</td><td>${t.dynamicValues?.sepHv || ""}</td><td>${t.dynamicValues?.sepLv || ""}</td><td>${t.dynamicValues?.ir || ""}</td>${CT_BURDEN_10.map(p=>`<td>${t.dynamicValues?.[`b10_${p}`] || ""}</td>`).join("")}${CT_BURDEN_25.map(p=>`<td>${t.dynamicValues?.[`b25_${p}`] || ""}</td>`).join("")}<td>${t.result}</td><td>${t.workflowStatus}</td></tr>`).join("")}</tbody></table>${footer(jobNumber)}`;
}

function ptPdf(tests: QCTestRecord[], jobNumber: string) {
  const row = (t: QCTestRecord, conn: string, pct: string, idx: number) => `<tr>${idx===0?`<td rowspan="6">${t.srNo}</td><td rowspan="6">${t.uniqueNo}</td><td rowspan="6">${t.dynamicValues?.polarity||""}</td><td rowspan="6">${t.dynamicValues?.sepLv03||""}</td><td rowspan="6">${t.dynamicValues?.dvdf||""}</td><td rowspan="6">${t.dynamicValues?.sepHv||""}</td><td rowspan="6">${t.dynamicValues?.ir||""}</td>`:""}<td>${conn}</td><td>${pct}</td><td>${t.dynamicValues?.[`${conn}_${pct}_ratio25`]||""}</td><td>${t.dynamicValues?.[`${conn}_${pct}_phase25`]||""}</td><td>${t.dynamicValues?.[`${conn}_${pct}_ratio625`]||""}</td><td>${t.dynamicValues?.[`${conn}_${pct}_phase625`]||""}</td>${idx===0?`<td rowspan="6">${t.result}</td><td rowspan="6">${t.dynamicValues?.remarks||""}</td>`:""}</tr>`;
  return `<table style="font-size:8px"><thead><tr><th colspan="15">ROUTINE TEST RESULT SHEET</th></tr><tr><th colspan="4">Type : 11 KV Resin Cast PT-3Ph</th><th colspan="3">I.L : 12/28/75 kVP</th><th colspan="5">Testing Engineer Name :</th><th colspan="3"></th></tr><tr><th rowspan="3">Sr. No.</th><th rowspan="3">UNIQUE NO</th><th rowspan="3">Polarity</th><th rowspan="3">LV 03 KV 60 sec.</th><th rowspan="3">DVDF</th><th rowspan="3">HV 60 sec</th><th rowspan="3">IR</th><th rowspan="3"></th><th colspan="5">Accuracy Class : 0.5</th><th rowspan="3">Conforms</th><th rowspan="3">Remarks</th></tr><tr><th colspan="3">Burden : 25 VA</th><th colspan="2">Burden : 6.25 VA</th></tr><tr><th>Percentage</th><th>Ratio Error</th><th>Phase Error</th><th>Ratio Error</th><th>Phase Error</th></tr></thead><tbody>${tests.flatMap(t => PT_CONNECTIONS.flatMap(conn => PT_PERCENTAGES.map((pct,i)=>row(t,conn,pct,PT_CONNECTIONS.indexOf(conn)*2+i)))).join("")}</tbody></table>${footer(jobNumber)}`;
}

function footer(jobNumber: string) {
  return `<div class="signs"><div class="sign-box">Testing Engineer</div><div class="sign-box">QC Approval</div><div class="sign-box">Digital Signature</div></div><div class="muted" style="font-size:10px;margin-top:16px">Printed: ${new Date().toLocaleString()} | Job Card: ${jobNumber}</div>`;
}