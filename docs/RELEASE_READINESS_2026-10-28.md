# CpIPOS Desktop release-readiness gate — 2026-10-28

**Status: NOT production accepted.** This document records repository evidence and outstanding hands-on QA. A successful GitHub build is not proof of an accepted production release.

## Branches and release provenance (updated 2026-10-28)

- Default branch: `main`. It contains merged PR #5 (history reconciliation) and #7 (license bearer-file protection).
- `dev/ui-system` was fast-forwarded to the same commit as `main` after PR #7.
- PR #3 was merged by GitHub history reconciliation through PR #5; PR #2 was closed without merging its incompatible Ed25519 issuer design. Follow-up security issue #6 remains open.
- Public customer installer release: `v0.3.4`, built from `publish/v0.3.4` on 2026-09-28, not from the current `main`.
- CI and development Windows installer builds on the aligned main/development code have passed. The result proves buildability, not customer hardware acceptance.
- Production Acceptance remains pending real Windows install/upgrade tests, hardware tests and verified signing evidence. The newest quality-gate branch adds fail-closed license storage and automated installer integrity checks; wait for the resulting PR CI before treating those changes as incorporated.
- No force-push of `main`, release tag rewriting, or silent republishing of existing `v0.3.4` artifacts.

## Automated tests (repository evidence)

- [x] GitHub Windows Build for published v0.3.4 completed successfully on 2026-09-28; Frontend build, SQLite migration smoke test, Rust check, release upload steps passed.
- [x] CI on reconciled `main`: release contract and token issuance tests passed (GitHub Actions run 40632719567).
- [x] PR #5 reconciled both histories; 17 original main prototype files are preserved in the archive.
- [x] Conflicting PR #2 received a documented security decision (closed unmerged); a compatible native implementation and migration tests remain tracked in issue #6.
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

Only close issue #1 or mark Desktop Production Accepted when **all** automated validations, security checks, signing evidence and real Windows/hardware/UAT entries have concrete evidence links. The integration PR #5 already merged safely; this does not make the hardware/UAT entries pass. Customer releases are separate explicit actions and are not part of a documentation or CI-only pull request.
