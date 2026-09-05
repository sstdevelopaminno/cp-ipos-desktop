# Desktop Roadmap

Status: development prototype; not production-ready. Phase 0 evidence: [BOOTSTRAP.md](BOOTSTRAP.md).

## Phase 1 — Offline core (active)
- [x] Separate source tree / repository boundary
- [x] CpIPOS POS UI primitives ported
- [x] Tauri + SQLite scaffold
- [x] Local login/shift/sale transaction prototype
- [ ] Replace demo PIN with secure hash
- [ ] Receipt screen
- [ ] Receipt reprint
- [ ] Sale history
- [ ] Backup/restore
- [ ] Offline Tauri verification: native launch, demo login, shift, POS/cart, CASH checkout and SQLite persistence without external APIs

Phase 1 is incomplete until all six items above (secure PIN hashing through offline Tauri verification) are complete. The development PIN is temporary/demo-only and is not secure authentication. PromptPay/Card record payment methods only; they do not verify that money was received from a payment gateway.

## Phase 2 — Hardware
- [ ] Windows printer enumeration
- [ ] ESC/POS 58/80mm
- [ ] Cash drawer pulse
- [ ] Barcode keyboard scanner

## Phase 3 — Distribution
- [x] Windows GitHub Actions skeleton
- [ ] Signing certificate/secrets
- [ ] GitHub Release artifact
- [ ] Existing CpIPOS website download link
- [ ] Updater manifest/signing

## Phase 4 — Optional cloud sync
- [ ] Sync protocol/idempotency
- [ ] Catalog pull
- [ ] Sales push
- [ ] Conflict policy
