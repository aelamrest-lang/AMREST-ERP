# AMREST ERP & Sales CRM — PRD

## Original Problem Statement
Cloud-based Transformer Manufacturing ERP & CRM with modules for Sales CRM, Quotation, Costing Sheet, BOM, Sales Order, Job Card, Inventory, Raw Material Hold & Issue, Purchase, Production, QC Testing, Delivery Challan, Invoice, Reports, User Roles & Permissions, Dashboard, and PDF generation.

## Stack
- Frontend: React + TypeScript + TailwindCSS
- Backend: FastAPI + MongoDB (Motor)
- Auth: JWT (localStorage, hydration on refresh)
- Storage: Emergent File & Media integration

## Implemented (highlights)
- Sales CRM, Quotations, Proformas, Sales Orders with item-wise delivery schedules
- Costings module with versioning, duplicate, side-by-side compare, trend chart, rate refresh
- **NEW (28-Feb-2026):** Monthly P&S Report page — Excel/CSV upload of monthly product sales (Month, Product Name, Quantity Sold, Item Sale Price, auto Total Amount); robust month parsing (YYYY-MM / Aug 2026 / Aug-26 / MM/YYYY / Excel serial); KPI cards; Month + Product filters; **Monthly Summary** shows Total Qty Sold as a clickable link that opens an "Items Sold — {Month}" drill-down modal (product breakdown with qty, amount, share — each row further drills into a product modal); qty can be overridden via the ✎ pencil (row highlighted amber with reset link); **Total Sales Amount is fixed / non-editable**; Monthly Trend bar charts (Total Sales & Total Qty); Comparison Sheet with Compare by Month / Compare by Year modes and side-by-side metric table + charts; Excel Clear-All; sample template download; persisted under `settings.monthlyPSRows` and `settings.monthlyPSOverrides` (qty overrides only). Sidebar entry under Insights.
- **NEW (31-Feb-2026):** Manufacturing Cost page — pick a Finished Good → BOM materials auto-loaded with latest purchase rates (most recent PO date per item; falls back to item master rate with a "No PO price" badge when unavailable); manual Labour Cost + Office Expense inputs; auto-computed Total Cost and Margin (₹ + %); manual Sale Price field. **Delivery Challan integration**: when a Job Card's finished good matches a saved manufacturing sheet, the challan's row rate auto-fills from that Sale Price (still editable and only used when the Sales Order didn't already have a rate). Persisted in `settings.manufacturingCosts` keyed by FG item id. Sidebar entry under Inventory & Production.
- **NEW (29-Feb-2026):** Job Card Product name now auto-syncs with the selected BOM name (both on initial open and when the BOM dropdown is changed) — the Job Card No., Reserved Inventory list and Product field always stay consistent with the BOM.
- **NEW (29-Feb-2026):** Inventory column sorting — clickable headers with ↕/▲/▼ indicators for Current Stock, Hold (Job Card), Available Stock, Avg Unit Cost, Total Valuation (₹) and Safety Buffer Status. Safety Buffer Status sorts by severity rank (Over-Committed > Below Buffer > Reorder Soon > Healthy).
- **NEW (29-Feb-2026):** Quotation Management — Owner Name filter (Sales Persons only) + State filter (Open/Revised/Confirmed/Closed) in list header; **Revise Quotation** action opens an editable modal (Qty/Rate/GST, Overall Discount % with Apply-to-all, Note) that saves a new revision (R1, R2, …) and updates the current line items; **Revision History** modal shows R0 (original), each revision (date, revised by, discount %, sub total, total, note) and a Current row; **Close Quotation** action requires a mandatory Reason (Price High / Customer Cancelled / Competitor / No Response / Other) plus optional note, and locks further edits (a **Reopen** action is available). Each row displays a colored State badge (blue Open · amber Revised · emerald Confirmed · rose Closed with reason tooltip).
- **NEW (29-Feb-2026):** Quotation No. is a clickable link that opens an **A4 Printable Preview** modal (exact PDF layout inside a locked-width iframe) with **Edit / Print / Download PDF / Close** actions.
- **NEW (29-Feb-2026):** Quotation → "+ Create New Customer" — the Customer dropdown in the New Quotation form now includes a "+ Create New Customer…" option pinned to the top with a highlighted indigo style. Selecting it opens an inline modal (Name required, GSTIN, Contact Person, Mobile, Email, City, Address, Payment Terms, Credit Limit); on save the customer is persisted to Party Master and auto-selected in the quotation form.
- **NEW (28-Feb-2026):** P&L ↔ P&S integration — the Monthly P&L **Sales** column now auto-pulls each month's Total Sales Amount from the Monthly P&S Report (`settings.monthlyPSRows`). Cells with P&S data become clickable (with a P&S pill) opening a "Sales from P&S Report — {Month}" drill-down (Rows / Total Qty / Total Sales KPI header + product-level table + info banner directing users to edit at the source). Months without P&S data still show the plain editable Sales input.
- **NEW (28-Feb-2026):** Monthly Profit & Loss sheet — fully manual, month-wise data entry (Opening/Purchase/Closing Stock, Sales, Indirect/Direct Expenses); auto-computes Consumed Stock, Total Expenses, Profit/Loss and Profit %; FY selector (Apr–Mar); FY totals row; Monthly Trend at top with 3-panel bar-chart (Sales/Total Expenses/Profit-Loss where negatives fall below zero baseline as red "Loss" bars); Closing Stock auto-cascades to next month's Opening Stock (still editable, with AUTO pill & reset link); **Comparison Sheet** with two modes (Compare by Month / Compare by Year); **Stock Excel Upload** — bulk-upload Opening/Purchase/Closing line items (Month, Type, Product Name, Quantity, Amount); **Expenses Excel Upload** — bulk-upload Indirect/Direct expense line items (Month, Type, Description, Amount); each cell with line items becomes a clickable link with an "N items" pill → opens a drill-down modal (KPI header + per-line table with Share %, Delete-per-row and Delete-all actions). Persisted in company settings under `monthlyPnl` + `monthlyPnlLines` + `monthlyPnlExpenses`. Sidebar entry under Insights.
- **NEW (12-Feb-2026):** Labour Charges % and Office Expenses % in Costing Sheet — auto-computed on Material Cost; flow into Total Costing, Profit and Sale Price (persisted, shown in list/print/history)
- **NEW (12-Feb-2026):** Inline "+ Create new finished good" in the FinishedGoodCombobox — one-click quick-add modal from Sales Orders, Quotations and Proformas; saves to Item Master and auto-selects into the current line
- BOM (with copy feature), Job Cards with Secondary Winding split into 3 substages
- Procurement: PO with approval, PDF, searchable vendor/PO comboboxes, GRN with over-receipt, freight/packing with GST, vendor invoice match, clickable ref numbers
- Operator Master with production stage mappings and monthly ledger
- Inventory, Raw Material Issue, Production, QC Testing, Delivery Challan (Invoice-style with partial dispatch & balance)
- Dashboards: Main (FY filter, drill-downs, product-mix donut, forecast bars, clickable low-stock), Tax Dashboard
- Utilities: Global fmt2() 2-decimal formatting, A4 WYSIWYG print, session hydration, AMREST tab title + favicon

## Admin Login
- Email: aaa@amrest.in
- Password: anwar@123
- Role: Admin
(see `/app/memory/test_credentials.md` for other roles)

## Backlog / Upcoming
- P1: Bulk edit sheet to update sale rates for many finished goods at once
- P1: Tax-paid summary in Reports for accounts to reconcile input tax credit
- P1: Attach supplier invoice PDFs/photos to a GRN with preview in the details modal
- P2: Refactor Costings.tsx (~800 lines), Dashboard.tsx, Procurement.tsx (extract history/trend/compare modals)
- P2: Advanced filters (date range) on PO list

## Notes
- The console hydration warning `<span> cannot be a child of <option>` from the raw-material `<datalist>` in Costings is dev-mode only (ve-dynamic wrapper). No functional impact; can be silenced later.

## Session Updates (2026-09-12)
- DONE: Production Stage Details KPI rework — Total Qty (JC stage target), Previously Completed, Balance Qty (auto), Total Amount cards in `/app/frontend/src/pages/Production.tsx` Stage Details modal.
- DONE: Inventory valuation logic — RM Avg Unit Cost = mean of latest 3 GRN purchase rates (fallback Item Master rate); FG valued at latest Item Master `saleRate`; applied to column, valuation, KPI, sorting, CSV export (`/app/frontend/src/pages/Inventory.tsx`).
- DONE: New "Production SFG" page (`/app/frontend/src/pages/ProductionSFG.tsx`, route id `sfg`): stage→SFG item mapping with auto-create item; consumption mapping (N SFGs → 1 stage, configurable qty/unit); auto SFG batch creation + stock increment on production entry; auto-consumption FIFO (same job card first, then others) + manual "Consume SFG" modal; stock table (SFG/Used/Available qty, JC, stage, date); full produced+consumed history ledger; JC-wise consumption drill-down modal on Used Qty. Shared logic in `/app/frontend/src/lib/sfg.ts`; types `SfgBatch`/`SfgConsumption` + `settings.sfgStageItems`/`sfgConsumptionMap`; persistence via whole-DB save.
- DONE: Data-loss guard — pending DB save flushes on beforeunload/visibilitychange (`saveRemoteDBFinal` with keepalive in `/app/frontend/src/lib/api.ts`, wired in store.tsx).
- User decision: SFG mapping stays global; consumption is same-JC-first with cross-JC fallback; stock table unchanged (no JC grouping).
- Testing: testing_agent iteration_5.json — 100% pass (mappings, auto production, auto+manual consumption, history, inventory sync, persistence).

