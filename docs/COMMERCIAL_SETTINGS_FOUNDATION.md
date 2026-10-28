# CpIPOS Desktop Commercial Settings Foundation

This document describes the four commercial settings areas in CpIPOS Desktop 0.2.0 and the temporary Free Forever release mode.

## Current release mode

CpIPOS Desktop 0.2.0 is released as **Free Forever / local-first** for testing and customer rollout preparation.

- Program license lock is disabled.
- License server connection is disabled.
- Remote MDM auto-connect is disabled.
- Backup/Restore API settings remain available for future backend IT connection.
- First-run printer setup can be skipped and configured later to avoid slow Windows printer discovery during installation.

## 1. ข้อมูลและพื้นที่

Purpose: let the shop archive local data before clearing old sales history and starting a new sales count.

Implemented UI flow:

1. Export Excel-compatible file (`.xls`) containing sales, sale items, receipts, cancellations, audit logs, stock ledger, products, staff, shifts, and app settings.
2. Export printable PDF report through the browser/WebView print dialog.
3. Export JSON backup for raw restore/debugging.
4. Archive and reset action:
   - opens a custom confirmation dialog instead of the browser-native prompt;
   - asks the owner to type `RESET`;
   - downloads Excel-compatible and JSON archive files first;
   - clears old sales tables only (`sale_items`, `receipts`, `sale_cancellations`, `sales`);
   - keeps products, employees, settings, license, and branch configuration;
   - reloads the app so counters start fresh.

This keeps master data safe while allowing the shop to start a new sales cycle.

## 2. Backup / Restore

Purpose: prepare cloud database connectivity as a paid package after backend IT is ready.

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
- Queue preparation button

The runtime stores these values under `cpipos.commercial.settings.v1`. Real production storage should later move sensitive values, especially API keys, to a native secret store or backend-issued token flow.

## 3. Remote Management / MDM

Purpose: keep the MDM foundation visible while preventing accidental backend connection in the Free Forever release.

Current behavior:

- Remote Management is disabled.
- Auto-connect is disabled.
- Heartbeat test is disabled.
- MDM Server URL, IT Backend URL, Device Token, and heartbeat interval can still be saved as draft configuration for the next backend phase.

## 4. ลายเส้นโปรแกรม / Program License

Purpose: keep the device/license UI visible while releasing the current installer as Free Forever.

Current behavior:

- First installation is not limited to 30 days.
- The runtime stores `CPIPOS-FREE-FOREVER` as the local license key.
- The UI displays Free Forever, lifetime usage, and the device fingerprint.
- License server activation/check is disabled.
- Any prior lock overlay is removed.

Future production rule: never put the private signing key inside the desktop app. The backend must sign license tokens; the desktop app should only verify them with a public key in the native layer.

## First-run printer setup

The first-run printer setup now uses a fast setup guard.

- Windows printer auto-discovery is skipped by default to avoid hanging or long first-run UI.
- The user can continue into the program and configure the printer later.
- A manual deep-scan button is available when a real printer search is needed.

## Installer and release

The Windows build workflow supports manual release builds with a version input such as `v0.2.0`. It creates draft GitHub releases and uploads `.exe` and `.msi` installer artifacts for download.

Recommended local release flow:

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
4. Choose channel, for example `stable`.
5. Wait for the draft release.
6. Download the `.exe` or `.msi` installer from the release/artifacts.
7. Upload the approved installer to the company download page.

## Next backend work

The desktop UI is ready for the backend contract. The next implementation phase should add:

- License backend API
- MDM backend API
- Cloud sync queue and conflict handling
- Native encrypted token/secret storage
- Signed license verification in Tauri/Rust
- Customer-specific release channel and download page integration
