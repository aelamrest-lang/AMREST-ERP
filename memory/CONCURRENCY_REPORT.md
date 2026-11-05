# AMREST ERP — Concurrent Saving: Design, Safeguards, Test Results, Rollback (2026-11-05)

## Design
- Storage: one MongoDB document per record (`erp_records`, `_id = <collection>:<recordId>`, `rev`, `ver`, `data`); settings sub-keys and scalars in `erp_values` (each with `rev`). No whole-database writes. Old PUT/PATCH `/api/erp/state` return 426 (old browser tabs must reload).
- Save API: `POST /api/erp/commit {opId, ops[]}`; ops = upsert / delete / inc (stock) / set (settings).
- Same-record edits: optimistic concurrency per record (`baseRev`). Mismatch → 409 → Conflict panel (field / when opened / mine / latest) with "Reload latest" or "Re-apply my changes". Stale open forms are detected too (a save that would revert another user's pulled change is sent with the old rev → conflict).
- Stock: only atomic `$inc` movements; item edits never overwrite `currentStock`; stale stock in open forms ignored.
- Document numbers: unique DB index per module (GRN, PO, MIS, JC, Invoice, Quotation, SO, Proforma). Duplicate → 409 → the tab takes the next free number (and fixes its own log/audit text) and retries.
- Idempotency: every batch has a one-time `opId` (`erp_applied`, TTL 30 days). Retries/replays never apply twice. Unsent batches kept in browser localStorage and re-sent after reload / re-login (checked first with `GET /api/erp/applied/{opId}`).
- Atomicity: all ops of a batch are validated first, then written under a server lock; inside a MongoDB transaction when the cluster is a replica set (Atlas). Activity-log rows are part of the same batch → only stored if the batch commits.
- Audit trail: `erp_audit` row per changed record (user, collection/module, record id, action, field from→to, time, opId). Logs/audit never deleted by clients.
- PO receipt status derived on the server from GRNs.
- Save indicator: Saving… / Saved / Unsaved changes / Save failed (Retry) / Conflict detected / Session expired (Log in again). "Saved" only after server confirmation.

## Migration (runs automatically on first start of the new backend)
1. Backup: chunk copy in `erp_backup_chunks` (backup id = timestamp); legacy single doc in `erp_state_backup`.
2. Migrate → verify record counts per collection and total item stock; on mismatch the new store stays OFF and old storage is kept.
3. Report: `GET /api/erp/migration-report`.
Preview result: 25 collections, counts identical (e.g. grns 368, productionEntries 578, qcTests 8870, items 1481), stock sum 587093.634 before = after.

## Rollback
- `python3 backend/scripts/rollback_storage.py --from-records` (keeps all data saved after migration) or `--from-backup <TS>` (exact pre-migration snapshot); `--list` shows backups. Then use platform Rollback to the previous app version.

## Test results (preview)
- API 5-session suite `backend/tests/test_concurrency.py`: 12/12 pass — 5 simultaneous GRNs, same-PO GRNs, same-GRN edit (200/409), 5 simultaneous production entries, concurrent stock in/out exact, retry same key not doubled, expired session 401 nothing written, duplicate number 200/409, 5 modules simultaneously, stale delete 409, cleanup.
- Edge suite `backend/tests/test_record_store_edge.py`: 7/7.
- UI (testing agent iterations 17–19): 5 browser sessions creating GRNs → all kept, unique numbers, exact stock and logs; conflict panel flows; offline → Save failed → Retry saves once; session expiry → re-login re-sends once; stale-form and stale-stock overwrites blocked; replay conflicts show correct "opened" values.

## Remaining risks
- Server lock is per process: safe with the current single backend worker. Multiple workers/pods need Atlas transactions (used automatically on replica sets) — confirm production is Atlas replica set.
- Without transactions (standalone Mongo) a crash mid-batch could leave a partial write.
- Two operators saving production on the SAME Job Card at the same moment get the Conflict panel (by design: "always conflict").
- Migration not yet run against a copy of PRODUCTION data (no access from preview); records already lost earlier in production are not restored.
