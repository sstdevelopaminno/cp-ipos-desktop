# CpIPOS Desktop Commercial Settings Foundation

This document describes the four commercial settings areas added for CpIPOS Desktop 0.2.0.

## 1. ข้อมูลและพื้นที่

Purpose: let the shop archive local data before clearing old sales history and starting a new sales count.

Implemented UI flow:

1. Export Excel-compatible file (`.xls`) containing sales, sale items, receipts, cancellations, audit logs, stock ledger, products, staff, shifts, and app settings.
2. Export printable PDF report through the browser/WebView print dialog.
3. Export JSON backup for raw restore/debugging.
4. Archive and reset action:
   - asks the owner to type `RESET`;
   - downloads Excel-compatible and JSON archive files first;
   - clears old sales tables only (`sale_items`, `receipts`, `sale_cancellations`, `sales`);
   - keeps products, employees, settings, license, and branch configuration.

This keeps master data safe while allowing the shop to start a new sales cycle.

## 2. Backup / Restore

Purpose: prepare cloud database connectivity as a paid package.

Implemented settings:

- Cloud API URL
- Tenant ID
- Store / Branch ID
- API Key
- Package: Offline, Cloud Basic, Cloud Pro, Enterprise
- Sync mode: Local only, Local + Cloud queue, Cloud primary when online
- Online contract flag
- Contract start/end date
- API test button

The runtime stores these values under `cpipos.commercial.settings.v1`. Real production storage should later move sensitive values, especially API keys, to a native secret store or backend-issued token flow.

## 3. Remote Management / MDM

Purpose: prepare remote management for devices with an active internet contract.

Implemented settings:

- Enable Remote Management
- MDM Server URL
- IT Backend URL
- Device Token
- Heartbeat interval, minimum 30 seconds
- Auto-connect when online
- Heartbeat test to `/heartbeat`
- Device fingerprint display

This is a foundation for backend IT to push policy, check status, and bind devices.

## 4. ลายเส้นโปรแกรม / Program License

Purpose: prepare device-bound licensing.

Implemented behavior:

- First installation gets a 30-day trial marker.
- The UI displays remaining trial days and device fingerprint.
- License key, server URL, package, duration, expiry, and signed token can be stored.
- Activation/check sends a request to `/api/licenses/activate`.
- If the trial expires and license is not active, the runtime shows a lock screen that asks the shop to connect internet and activate through backend IT.

Production rule: never put the private signing key inside the desktop app. The backend must sign license tokens; the desktop app should only verify them with a public key in the native layer.

## Installer and release

The Windows build workflow now supports manual release builds with a version input such as `v0.2.0`. It creates draft GitHub releases and also uploads `.exe` and `.msi` installer artifacts for download.

Recommended release flow:

```bash
git checkout dev/ui-system
git pull origin dev/ui-system
npm run build
npm run desktop:build
```

For GitHub Actions:

1. Open GitHub Actions.
2. Run `Windows Build`.
3. Input version, for example `v0.2.0`.
4. Wait for the draft release.
5. Download the `.exe` or `.msi` installer from the release/artifacts.
6. Upload the approved installer to the company download page.

## Next backend work

The desktop UI is now ready for the backend contract. The next implementation phase should add:

- License backend API
- MDM backend API
- Cloud sync queue and conflict handling
- Native encrypted token/secret storage
- Signed license verification in Tauri/Rust
- Customer-specific release channel and download page integration
