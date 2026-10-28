# CpIPOS Desktop release-readiness gate — 2026-10-28

**Status: NOT production accepted.** This document records repository evidence and outstanding hands-on QA. A successful GitHub build is not proof of an accepted production release.

## Branches and release provenance

- Default branch: `main` (older foundation).
- Active engineering branch: `dev/ui-system`.
- Public installer release: `v0.3.4`, built from `publish/v0.3.4` on 2026-09-28, not from `main`.
- Existing open PR #3 (`dev/ui-system` -> `main`) is not mergeable. Compare shows history diverged (development +323 commits, behind main by 22 when checked).
- Existing open PR #2 (`dev/license-security` -> `dev/ui-system`) is also not mergeable and lags the active engineering branch. Do not merge or close without comparing native-license functionality, current key ring and trial/device migration behavior.
- Do not rewrite `main`, force-push release tags, silently ship an installer, or remove the published `v0.3.4` artifacts to work around this divergence.

## Automated tests (repository evidence)

- [x] GitHub Windows Build for published v0.3.4 completed successfully on 2026-09-28; Frontend build, SQLite migration smoke test, Rust check, release upload steps passed.
- [ ] This branch: automated release metadata and token-issuance tests pass in PR CI.
- [ ] A safe integration branch reconciles `main` and `dev/ui-system` without discarding either side's changes.
- [ ] PR #2's native license verification receives a security decision and migration test, not a blind merge.
- [ ] Pin default owner reset/change is enforced at onboarding; verify storage migration and role authorization.
- [ ] Confirm a newly built release uses production signing secrets, updater signatures and Windows Authenticode signing where required.

## Windows customer acceptance — real device required

- [ ] Clean install and uninstall of NSIS .exe and MSI on Windows 10/11, including WebView2 prerequisites.
- [ ] Offline PIN login, open shift, barcode/quantity scan, sale, cash payment, stock ledger, close shift, restart, verify SQLite persists.
- [ ] Transfer/PromptPay/QR: explicitly label non-verified payment recording; do not claim gateway settlement without actual confirmation.
- [ ] Printed receipt 58 mm and 80 mm, Thai text and totals, duplicate-print prevention / authorized reprint.
- [ ] Windows printer enumeration, cash drawer opening, scanners, barcode label printing, offline exception handling.
- [ ] Discounts, void permissions and audit trail, refund/stock ledger correction.
- [ ] Backup/restore with a non-empty sale history and corrupted-backup recovery test.
- [ ] License: valid 1-device/2-device, wrong device, expired, future start, modified signature, 7-day trial and rollback detection; test both fresh and existing installs.
- [ ] Updater test: trusted signature verification, upgrade from v0.3.3 to the candidate without losing SQLite, rollback/recovery and IT policy.
- [ ] Responsive UI smoke tests at 1366x768 and 1920x1080; no blank startup screen.
- [ ] Confirm existing and new customer installation/upgrade instructions and website download URL.

## Security and company naming

The official trading/company display name is **CUTTING POINT INNOVATION CO., LTD.** (บริษัท คัตติ้ง พอยท์ อินโนเวชั่น จำกัด).

The signed protocol's `issuer: "CUTTING-POINT-TECH-IT"` is a **legacy cryptographic identifier**, not a display-name field. Preserve it for existing issued licenses unless IT coordinates a versioned issuer/key migration with backwards-compatible verification. The private signing key must remain outside GitHub and must never be displayed in CI logs. Issued license tokens are bearer credentials and must also not be printed in routine logs.

Tauri updater `.sig` files are signatures for the updater channel; they are **not** Windows Authenticode certificates. Do not mark Windows code signing as done based only on the presence of `.sig` assets.

## Closure rule

Only close issue #1 and merge the integration PR after the automated validations and the real Windows/hardware/UAT entries are marked with links to evidence. Customer releases are separate explicit actions and are not part of a documentation or CI-only pull request.
