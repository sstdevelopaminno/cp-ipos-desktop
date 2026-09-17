# CpIPOS Desktop Offline License

CpIPOS Desktop uses an offline signed-license model. The application contains only the company public key. The matching private key must stay with CUTTING POINT TECH IT and must never be committed to GitHub, bundled with the installer, emailed casually, or copied onto customer machines.

## Customer flow

1. Install CpIPOS Desktop.
2. The application creates a Device Code and starts a 7-day trial.
3. Customer sends the Device Code to CUTTING POINT TECH IT.
4. IT issues one signed license for exactly one or two Device Codes.
5. Customer pastes the `CP1...` token into the License window.
6. The application verifies the ECDSA P-256 signature locally, checks product/issuer, device binding, activation date and expiry, then unlocks production mode.
7. Copying the same token to an unlisted third machine fails with `LICENSE_DEVICE_NOT_ALLOWED`.

## Issue a license on the IT machine

Keep `cpipos-license-private-key.pem` outside the repository on an IT-controlled machine.

```powershell
$env:CPIPOS_LICENSE_PRIVATE_KEY="D:\CpIPOS-License\cpipos-license-private-key.pem"
node scripts/issue-offline-license.mjs --license-id CP-2026-000001 --customer "Example Store" --plan "Offline Standard" --device CP-AAAAA-BBBBB-CCCCC-DDDDD --out CP-2026-000001.txt
```

Two-machine license:

```powershell
node scripts/issue-offline-license.mjs --license-id CP-2026-000002 --customer "Example Store" --plan "Offline 2 Devices" --device CP-AAAAA-BBBBB-CCCCC-DDDDD --device CP-11111-22222-33333-44444 --out CP-2026-000002.txt
```

Optional expiry:

```powershell
node scripts/issue-offline-license.mjs --license-id CP-2026-000003 --device CP-AAAAA-BBBBB-CCCCC-DDDDD --expires 2027-12-31T23:59:59+07:00
```

## Security properties

- Private signing key is never shipped with the POS application.
- License fields such as device count, plan and expiry are signed and cannot be changed without invalidating the signature.
- Device binding is enforced from the signed `devices` list, with a hard limit of two devices in this version.
- Trial start and last-seen timestamps are persisted in local SQLite when available; clock rollback beyond the tolerance locks the program temporarily.
- The legacy editable License fields in Settings are hidden from normal UI and are not authoritative.

## Important limitation

No fully offline desktop application can be made impossible to crack when an attacker has administrator access to the customer computer. A skilled attacker can patch executable or JavaScript bundles. This implementation prevents ordinary license forgery and casual copying. Before commercial release, add a second verification layer in native Rust/Tauri, Windows code signing, binary hardening/obfuscation, and release integrity checks.
