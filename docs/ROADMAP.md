# Desktop Roadmap

Status: retail core foundation active; not production-ready. Phase 0 evidence: [BOOTSTRAP.md](BOOTSTRAP.md).

## Phase 1 - Offline retail foundation

- [x] Standalone repository boundary
- [x] CpIPOS branding and Windows icons
- [x] Splash/startup and local session restore
- [x] Desktop navigation
- [x] Product grid sales and barcode scan lookup
- [x] Product create/edit modal with product code, barcode, Thai/English names, grocery units and local image reference
- [x] Cart edit/remove/cancel bill approval flow
- [x] Cash payment keypad and transfer/PromptPay/card recording-only flows
- [x] Local receipt modal and receipt reprint from SQLite sale data
- [x] Sales history and daily summary reports
- [x] Stock ledger and minimum-stock warning
- [x] Employee management foundation
- [x] Settings, language switch, storage health and About/version foundation
- [x] Local audit history
- [x] Completed sale void with authorization, reason, audit and optional returned-stock ledger movement
- [x] Secure PIN hashing
- [ ] Receipt screen production hardening
- [ ] Receipt reprint production hardening
- [ ] Sales history production hardening
- [ ] Backup/restore
- [ ] Offline Tauri verification for release builds
- [ ] Real printer hardware integration
- [ ] Full installer/signing release verification

Phase 1 is not complete until receipt screen, receipt reprint, sales history, backup/restore, first-run PIN-change hardening and offline Tauri verification are completed. Do not mark production-ready.

## Phase 2 - Hardware

- [ ] Windows printer enumeration
- [ ] ESC/POS 58/80mm printing
- [ ] Cash drawer pulse
- [ ] Barcode scanner device profile tuning

## Phase 3 - Distribution

- [x] Windows GitHub Actions skeleton
- [ ] Signing certificate/secrets
- [ ] GitHub Release artifact
- [ ] Existing CpIPOS website download link
- [ ] Updater manifest/signing

## Phase 4 - Optional device/cloud management

- [ ] Device health reporting
- [ ] User-consented remote support workflow
- [ ] Backup status reporting
- [ ] Optional catalog sync after local commit

Offline sales must never depend on cloud/device management.
