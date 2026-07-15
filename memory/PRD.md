# Transformer Manufacturing ERP & CRM — PRD

## Original Problem Statement
Build a cloud-based Transformer Manufacturing ERP & CRM similar to the attached reference (AMREST Electricals). Maintain the same workflow, UI, modules and business logic while improving performance and UX. Include modules for Sales CRM, Quotation, Costing Sheet, BOM, Sales Order, Job Card, Inventory, Raw Material Hold & Issue, Purchase, Production, QC Testing, Delivery Challan, Invoice, Reports, User Roles & Permissions, Dashboard, and PDF generation. Real-time inventory updates, job-card-wise production tracking, multi-stage production, SKU management, bulk import/export, and a cloud DB. Modern React + TypeScript, responsive, secure, scalable.

## Architecture
- **Backend**: FastAPI + MongoDB with JWT auth. Single-document `erp_state` collection storing the full ERP DB as JSON (mirrors the reference's Supabase single-JSONB approach). Endpoints: `/api/auth/login`, `/api/erp/state` (GET/PUT), `/api/erp/version`.
- **Frontend**: React 19 + TypeScript (CRA/craco), Tailwind v3. All state hydrated on login, saved with 400ms debounce, polling `/api/erp/version` every 15s picks up remote changes.
- **PDF**: jsPDF + html2canvas client-side.
- **Realtime**: Version polling (no websocket needed given single-writer + light polling).

## Modules Implemented (v1)
Dashboard, Leads & Inquiry, Party Master, Item Master, Quotations, Proforma Invoices, Sales Orders, Purchase Orders, GRN, Inventory, Raw Material Issue, BOM, Job Cards, Production, QC Testing, Delivery Challans, Reports, Users, Company Settings, Document Format Settings, Activity Logs, Profile.

## User Personas
- Admin: full access + user administration
- Sales: leads/parties/quotations/proforma/SO (own records)
- Production: BOM/job cards/production stages/testing
- Purchase: vendors/PO/GRN
- Testing: QC workflow
- Store: item master, inventory, GRN, issue, challans

## Core Requirements (static)
- Role-based permission matrix per module × action (view/create/edit/delete/approve/print/export)
- Real-time inventory decrement on material issue
- Multi-stage production tracking with serial-wise job cards
- Multi-format PDF generation for all documents
- Bulk CSV export on key modules

## What's Been Implemented (2026-02-15)
- Full FastAPI backend (auth + state) with seed users
- 22 pages, 6 roles, full permission matrix
- Debounced auto-save + 15s version polling for near-realtime sync
- Client-side PDF & CSV export utilities
- Dark/light theme toggle
- Test credentials saved at `/app/memory/test_credentials.md`

## Prioritized Backlog
- P1: Add PBAC-based backend enforcement (currently trust client)
- P1: Server-side password hashing (bcrypt) — currently plain (matches reference for demo)
- P1: WebSocket-based realtime instead of 15s polling
- P2: Backend PDF generation fallback
- P2: Optimistic concurrency / conflict resolution on state save
- P2: File-storage integration for signatures, logos, QC attachments
- P2: Backup/restore export of full erp_state
