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
- **NEW (28-Feb-2026):** Monthly Profit & Loss sheet — fully manual, month-wise data entry (Opening/Purchase/Closing Stock, Sales, Indirect/Direct Expenses); auto-computes Consumed Stock, Total Expenses, Profit/Loss and Profit %; FY selector (Apr–Mar); FY totals row; 3-panel bar-chart trend (Sales / Total Expenses / Profit); persisted in company settings under `monthlyPnl`. Sidebar entry under Insights.
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
