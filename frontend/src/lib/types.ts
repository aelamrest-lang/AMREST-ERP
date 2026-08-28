export type Role = "admin" | "sales" | "production" | "purchase" | "testing" | "store";

export type PermissionAction = "view" | "create" | "edit" | "delete" | "approve" | "print" | "export";
export type ModulePermission = Record<PermissionAction, boolean>;
export type PermissionMatrix = Record<string, ModulePermission>;

export interface User {
  id: string;
  name: string;
  email: string;
  username: string;
  password: string; // demo: plain text
  role: Role;
  customRoleName?: string;
  permissions?: PermissionMatrix;
  active: boolean;
  createdAt: string;
}

export interface Party {
  id: string;
  name: string;
  type: "customer" | "vendor" | "supplier";
  gst?: string;
  address?: string;
  city?: string;
  contactPerson?: string;
  mobile?: string;
  email?: string;
  paymentTerms?: string;
  creditLimit?: number;
  ownerId: string; // sales user id
  createdAt: string;
}

export interface Item {
  id: string;
  code?: string;
  name: string;
  category: "Raw Material" | "Finished Goods" | "Semi-Finished";
  productCategory?: string; // e.g. Transformer, CT & PT, Epoxy Item — used by Costing Sheets
  unit: string;
  hsn?: string;
  gstRate: number;
  openingStock: number;
  currentStock: number;
  minStock: number;
  reorderLevel: number;
  purchaseRate: number;
  saleRate: number;
}

export interface CostingMaterial {
  itemId?: string;
  name: string;
  unit?: string;
  qty: number;
  rate: number;
}

export interface CostingVersion {
  version: number;
  updatedAt: string;
  updatedBy?: string;
  materials: CostingMaterial[];
  marginPct: number;
  gstRate: number;
  totalCost: number;
  salePrice: number;
  profit: number;
}

export interface CostingSheet {
  id: string;
  number: string;
  title: string;
  productItemId?: string;
  productName?: string;
  customerId?: string;
  kva?: string;
  materials: CostingMaterial[];
  gstRate: number;
  marginPct: number;
  labourPct?: number;
  officePct?: number;
  usdExchangeRate?: number; // ₹ per 1 USD (for USD Sale Price display)
  productCategory?: string; // e.g. Transformer, CT & PT, Epoxy Item
  status: "draft" | "pending" | "approved" | "rejected";
  locked?: boolean;
  ownerId: string;
  createdAt: string;
  version: number;
  history?: CostingVersion[];
  sequence?: number;
}

export type DocStatus =
  | "Inquiry"
  | "Quotation Sent"
  | "Negotiation"
  | "Order Confirmed"
  | "Production"
  | "Delivered";

export interface Quotation {
  id: string;
  number: string;
  date: string;
  customerId: string;
  costingId?: string;
  items: { name: string; description?: string; qty: number; rate: number; gst: number }[];
  terms: string;
  status: DocStatus;
  ownerId: string;
  createdAt: string;
}

export interface Proforma {
  id: string;
  number: string;
  date: string;
  quotationId?: string;
  customerId: string;
  items: { name: string; qty: number; rate: number; gst: number }[];
  paymentTerms: string;
  transport?: string;
  ownerId: string;
  createdAt: string;
}

export interface DeliverySchedule {
  id: string;
  date: string;           // YYYY-MM-DD
  qty: number;            // scheduled quantity for this slot
  deliveredQty?: number;  // qty already delivered against this slot (default 0)
  note?: string;
  itemName?: string;      // when SO has multiple products, which line item this slot belongs to
}

export interface SalesOrder {
  id: string;
  number: string;
  date: string;
  customerId: string;
  proformaId?: string;
  items: { name: string; qty: number; rate: number; gst: number }[];
  freight?: number;
  deliveryDate?: string;
  schedules?: DeliverySchedule[];
  status: "Pending" | "Confirmed" | "In Production" | "Dispatched" | "Delivered";
  ownerId: string;
  createdAt: string;
}

export interface POApprovalEvent {
  userId: string;
  userName: string;
  action: "Submitted" | "Approved" | "Rejected" | "Resubmitted";
  reason?: string;
  timestamp: string;
}

export interface PurchaseOrder {
  id: string;
  number: string;
  date: string;
  vendorId: string;
  items: { itemId: string; qty: number; rate: number; gst?: number; description?: string }[];
  terms?: string;
  expectedDeliveryDate?: string;
  status: "Draft" | "Approved" | "Partially Received" | "Received" | "Completed" | "Cancelled";
  approvalStatus?: "Pending" | "Approved" | "Rejected";
  approvedById?: string;
  approvedByName?: string;
  approvedAt?: string;
  rejectionReason?: string;
  approvalHistory?: POApprovalEvent[];
  createdAt: string;
  createdByName?: string;
  createdById?: string;
}

export interface GRN {
  id: string;
  number: string;
  date: string;
  poId: string;
  receivedItems: { itemId: string; qty: number }[];
  qcPassed: boolean;
  freight?: number;
  freightEnabled?: boolean;
  freightGst?: number;
  packing?: number;
  packingEnabled?: boolean;
  packingGst?: number;
  vendorInvoiceNo?: string;
  vendorInvoiceAmount?: number;
  createdAt: string;
}

export interface MaterialIssueLine {
  itemId: string;
  requiredQty: number;
  alreadyIssuedQty: number;
  pendingQty: number;
  currentStock: number;
  issueQty: number;
  unit: string;
  status: "Pending" | "Partial Issued" | "Fully Issued";
}

export interface MaterialIssue {
  id: string;
  number: string;
  date: string;
  jobCardId: string;
  jobCardNumber: string;
  productName: string;
  bomId?: string;
  storeLocation: string;
  issueBy: string;
  remarks: string;
  lines: MaterialIssueLine[];
  createdAt: string;
}

export interface BOM {
  id: string;
  name: string; // e.g. 100 KVA Transformer
  productItemId?: string;
  kva: string;
  materials: { itemId?: string; name: string; qty: number; unit: string }[];
  createdAt: string;
}

export type ProductionStage = string;

export interface ProductionEntry {
  id: string;
  date: string;
  jobCardId: string;
  jobCardNumber: string;
  stage: ProductionStage;
  productName: string;
  totalJobQty: number;
  stageMultiplier?: number;
  previousCompletedQty: number;
  todayQty: number;
  balanceQty: number;
  operatorName: string;
  operatorId?: string;
  shift: "Day" | "Night" | "General";
  machineName: string;
  status?: "Pending" | "Running" | "Completed" | "Hold";
  remarks: string;
  priceEach?: number;
  createdAt: string;
}

export interface Operator {
  id: string;
  name: string;
  department?: string;
  stages?: ProductionStage[];
  defaultRate?: number;
  active: boolean;
  createdAt: string;
}

export interface SerialRecord {
  id: string;
  serialNo: string;
  jobCardId: string;
  productName: string;
  productionStatus: "Pending" | "In Production" | "Completed";
  qcStatus: "Pending" | "Pass" | "Fail" | "Hold" | "Approved";
  dispatchStatus: "Pending" | "Ready" | "Dispatched";
  reworkStatus: "None" | "Rework" | "Scrap";
  customerId?: string;
  warrantyStatus: "Pending" | "Active" | "Expired";
  createdAt: string;
}

export interface QCTestRecord {
  id: string;
  jobCardId: string;
  serialNo: string;
  srNo: number;
  uniqueNo: string;
  polarity: string;
  hvTitle: string;
  hvAmbientTemp: number;
  hvAB: string;
  hvBC: string;
  hvCA: string;
  lvTitle: string;
  lvAB: string;
  lvBC: string;
  lvCA: string;
  ratioR: string;
  ratioY: string;
  ratioB: string;
  irHVE: string;
  irLVE: string;
  irHVLV: string;
  dvdfVolt: string;
  hvKv: string;
  lvKv: string;
  result: "Pending" | "Pass" | "Fail" | "Hold";
  workflowStatus: "Testing Entry" | "QC Verification" | "QC Approval" | "Final Approval" | "Ready For Dispatch";
  testingEngineer: string;
  dateOfTesting: string;
  qcFormatId?: string;
  dynamicValues?: Record<string, string>;
  returnedToInventory?: boolean;
}

export interface QCFormat {
  id: string;
  name: string;
  useFor: string;
  attachmentName?: string;
  attachmentType?: string;
  attachmentUrl?: string;
  columns: { id: string; name: string; width?: number; parameter?: string; passFailLogic?: string; autoCalculation?: string }[];
  pdfLayout: "table" | "certificate" | "routine";
  createdAt: string;
}

export interface QCFinalReportAttachment {
  id: string;
  jobCardId: string;
  fileName: string;
  fileType: string;
  fileUrl: string;
  uploadedBy: string;
  uploadedAt: string;
}

export interface JobCard {
  id: string;
  number: string;
  date: string;
  salesOrderId?: string;
  bomId?: string;
  qcFormatId?: string;
  product: string;
  qty: number;
  serialStart?: string;
  reservedItems: { itemId: string; qty: number }[];
  stageQuantities?: { stage: ProductionStage; multiplier: number; totalQty: number }[];
  stagePrices?: Record<string, number>; // key: ProductionStage → ₹ per unit fixed at JC level
  stages: { stage: ProductionStage; status: "pending" | "in-progress" | "done"; worker?: string; date?: string }[];
  status: "Open" | "In Progress" | "Completed";
  createdAt: string;
}

export interface DeliveryChallan {
  id: string;
  number: string;
  date: string;
  salesOrderId: string;
  jobCardId?: string;
  customerId: string;
  items?: { name: string; qty: number; rate: number; gst: number }[];
  freight?: number;
  vehicle?: string;
  driver?: string;
  transport?: string;
  acknowledged: boolean;
  createdAt: string;
}

export interface Lead {
  id: string;
  date: string;
  customerName: string;
  contactPerson?: string;
  contact: string;
  email?: string;
  product: string;
  notes: string;
  status: "Inquiry" | "Quotation Sent" | "Negotiation" | "Order Confirmed" | "Production" | "Delivered" | "New" | "Followup" | "Quoted" | "Converted" | "Lost";
  ownerId: string;
  followups: { date: string; note: string }[];
}

export interface CTLine {
  description: string;
  specification: string;
  weight: number;
  unit: string;
  rate: number;
  idMm?: number;
  odMm?: number;
  heightMm?: number;
  density?: number;
  swg?: "17" | "18" | "19" | "20";
  turns?: number;
  swgWeightPerMeter?: number;
  copperLengthMeter?: number;
  mltMeter?: number;
}

export type CTWorkflowKey = "enquiry" | "quotation" | "salesOrder" | "po" | "grn" | "inventory" | "jobCard" | "production" | "quality" | "challan" | "dispatch" | "pdf";

export interface CTWorkflowStage {
  key: CTWorkflowKey;
  label: string;
  completed: boolean;
  ref: string;
  date: string;
  notes: string;
}

export interface CTRecord {
  id: string;
  number: string;
  date: string;
  projectType: string;
  productType: string;
  customerId: string;
  customerName: string;
  contact: string;
  productDetails: string;
  ratio: string;
  burdenClass: string;
  lines: CTLine[];
  labourPct: number;
  marginPct: number;
  gstPct: number;
  workflow: CTWorkflowStage[];
  approved: boolean;
  ownerId: string;
  createdAt: string;
}

export interface ActivityLog {
  id: string;
  userId: string;
  action: string;
  module: string;
  timestamp: string;
}

export interface CompanySettings {
  name: string;
  address: string;
  gst: string;
  email: string;
  phone: string;
  logoText: string;
  logoUrl?: string;
  invoicePrefix: string;
  fyStart: string;
  documentFormats?: DocumentFormat[];
  expectedSales?: Record<string, number>; // key: "YYYY-MM" → ₹ expected sales for that month
  stagePrices?: Record<string, number>; // key: ProductionStage → ₹ per unit
  stageDays?: Record<string, number>; // key: ProductionStage → working days per stage (Mfg Time Calculator, legacy)
  stageCapacity?: Record<string, number>; // key: MfgStage → daily output (Nos/day) for Mfg Time Calculator
  rawMaterialProcurementDays?: number; // editable RM procurement window (days)
  itemLeadTimeDays?: Record<string, number>; // key: itemId → default purchase lead time (days)
  mfgTimeByProduct?: Record<string, { procurementDays: number; stageCapacity: Record<string, number> }>;
  productCategories?: string[]; // master list of product categories for Costing Sheets
  monthlyPnl?: Record<string, { opening: number | null; purchase: number; closing: number; sales: number; indirect: number; direct: number }>; // key: YYYY-MM; opening=null means auto-inherit from previous month's closing
  monthlyPSRows?: Array<{ id: string; month: string; product: string; qty: number; price: number; amount: number }>; // Monthly P&S Report — Excel-uploaded product sales rows (month=YYYY-MM)
  monthlyPSOverrides?: Record<string, { qty?: number; amount?: number }>; // Monthly P&S — manual month-level overrides (supersede aggregates); key=YYYY-MM
}

export interface DocumentTerm {
  id: string;
  text: string;
  active: boolean;
  order: number;
}

export interface DocumentFormat {
  id: string;
  documentType: string;
  formatName: string;
  active: boolean;
  logoUrl?: string;
  companyName: string;
  address: string;
  gstNo: string;
  contactDetails: string;
  headerContent: string;
  footerContent: string;
  terms: DocumentTerm[];
  bankDetails: string;
  declaration: string;
  signatureName: string;
  signatureUrl?: string;
  qrCode: boolean;
  watermark?: string;
  fitToSinglePage?: boolean;
  pageSize: "A4" | "A5";
  orientation: "Portrait" | "Landscape";
  createdAt: string;
  updatedAt: string;
}

export interface DB {
  users: User[];
  parties: Party[];
  items: Item[];
  costings: CostingSheet[];
  quotations: Quotation[];
  proformas: Proforma[];
  salesOrders: SalesOrder[];
  purchaseOrders: PurchaseOrder[];
  grns: GRN[];
  materialIssues: MaterialIssue[];
  boms: BOM[];
  jobCards: JobCard[];
  challans: DeliveryChallan[];
  productionEntries: ProductionEntry[];
  operators: Operator[];
  serials: SerialRecord[];
  qcTests: QCTestRecord[];
  qcFormats: QCFormat[];
  qcFinalReports: QCFinalReportAttachment[];
  leads: Lead[];
  ctCostings: CTRecord[];
  logs: ActivityLog[];
  settings: CompanySettings;
}
