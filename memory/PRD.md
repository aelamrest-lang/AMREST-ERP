# AMREST ERP & Sales CRM — PRD

## Original Problem Statement
Cloud-based Transformer Manufacturing ERP & CRM with modules for Sales CRM, Quotation, Costing Sheet, BOM, Sales Order, Job Card, Inventory, Raw Material Hold & Issue, Purchase, Production, QC Testing, Delivery Challan, Invoice, Reports, User Roles & Permissions, Dashboard, and PDF generation.

## Stack
- Frontend: React + TypeScript + TailwindCSS
- Backend: FastAPI + MongoDB (Motor)
- Auth: JWT (localStorage)
- Storage: Emergent File & Media integration

## Implemented (highlights)
- Sales CRM, Quotation, Proforma, Sales Orders (with delivery schedules, inline product view)
- BOM (with copy feature), Job Cards (auto-BOM append)
- Procurement: PO with approval workflow, PDF gen, searchable vendor/PO comboboxes, partial GRN, lead-time defaults, overdue tracking
- **NEW (28-Jul-2026):** Vendor/PO number search in Purchase Orders list (top of list, live filter)
- Inventory, Raw Material Issue, Production, QC Testing, Delivery Challan
- Dashboards: Main (FY filter, drill-downs, product-mix donut, forecast bars, low-stock), Tax Dashboard
- Utilities: Global fmt2() 2-decimal formatting, A4 WYSIWYG print
- Users & Permissions with department-scoped access

## Admin Login
- Email: aaa@amrest.in
- Password: anwar@123
- Role: Admin

## Backlog / Upcoming
- P0: Login Session Fix & UI Polish (spinner, blue→green button transition, dashboard redirect, refresh persistence)
- P2: Refactor Dashboard.tsx and Procurement.tsx (1000+ lines each)
- P2: Advanced filters (date range) on PO list
