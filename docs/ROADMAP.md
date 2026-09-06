# Desktop Roadmap

Status: retail core foundation active; not production-ready. Phase 0 evidence: [BOOTSTRAP.md](BOOTSTRAP.md).

## Phase 1 — Offline retail foundation

- [x] Standalone repository boundary
- [x] CpIPOS branding and Windows icons
- [x] Splash/startup and local session restore
- [x] Desktop navigation
- [x] Product grid sales and barcode scan lookup
- [x] Cart edit/remove/cancel bill approval flow
- [x] Cash payment keypad and transfer manual confirmation
- [x] Receipt modal and reprint from SQLite sale data
- [x] Sales history and daily summary reports
- [x] Product management and local image media reference
- [x] Stock movements and minimum-stock warning
- [x] Employee management foundation
- [x] Settings, storage health and About/version section
- [x] Local audit history
- [ ] Secure PIN hashing for production
- [ ] Real printer hardware integration
- [ ] Backup/restore implementation
- [ ] Full installer/signing release verification

## Phase 2 — Hardware

- [ ] Windows printer enumeration
- [ ] ESC/POS 58/80mm printing
- [ ] Cash drawer pulse
- [ ] Barcode scanner device profile tuning

## Phase 3 — Distribution

- [x] Windows GitHub Actions skeleton
- [ ] Signing certificate/secrets
- [ ] GitHub Release artifact
- [ ] Existing CpIPOS website download link
- [ ] Updater manifest/signing

## Phase 4 — Optional device/cloud management

- [ ] Device health reporting
- [ ] User-consented remote support workflow
- [ ] Backup status reporting
- [ ] Optional catalog sync after local commit

Offline sales must never depend on cloud/device management.