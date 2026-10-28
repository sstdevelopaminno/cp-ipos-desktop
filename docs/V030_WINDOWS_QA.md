# CpIPOS Desktop v0.3.0 - Windows QA

This checklist is the release gate before publishing the v0.3.0 installer.

## 1. Update the local source

```powershell
cd E:\cp-ipos-desktop
git status
git fetch origin
git switch dev/ui-system
git pull --ff-only origin dev/ui-system
npm install
```

Do not continue if `git status` shows local work that you still need to keep. Commit or back it up first.

## 2. Run the real Tauri desktop app

```powershell
npm run desktop:dev
```

Use `desktop:dev`, not only the browser preview, for license/device testing.

## 3. First-launch checks

- CpIPOS opens without a blank screen.
- License status shows a 7-day trial on a new installation.
- Open the License window from the floating license status control.
- Copy the Device Code. It must match `CP-AAAAA-BBBBB-CCCCC-DDDDD` format.
- Close and reopen CpIPOS and confirm the Device Code is unchanged.

## 4. IT Backoffice issuance

In CpIPOS IT Admin open:

`แพ็กเกจและสิทธิ์ > ออก License POS Desktop`

Test these license types:

1. One-device perpetual license.
2. One-device license with an expiry date.
3. Two-device license containing two different Device Codes.
4. Expired license for rejection testing.

The IT server must have `CPIPOS_LICENSE_PRIVATE_KEY_PEM` or `CPIPOS_LICENSE_PRIVATE_KEY_BASE64` configured as a server-side secret. Never commit the private key to GitHub.

## 5. Desktop activation checks

For each valid license:

- Paste the complete `CP1...` token into the License window.
- Press `ตรวจสอบและเปิดใช้งาน`.
- Confirm status becomes `License ใช้งานจริง`.
- Confirm License ID, plan, device count and expiry match the signed values from IT.
- Restart the application and confirm the license remains active while offline.

## 6. Rejection checks

Confirm CpIPOS rejects:

- a token with one character changed;
- a token issued for another Device Code;
- an expired token;
- a token whose activation date is still in the future;
- a one-device token copied to an unlisted second machine;
- a two-device token copied to an unlisted third machine.

## 7. Trial and clock checks

- Trial works without a license only inside the allowed trial period.
- After trial expiry, the sales application is blocked by the license lock screen.
- A large backward system-clock change triggers the temporary lock protection.

## 8. POS regression checks

After license activation verify:

- PIN login;
- open shift;
- product/barcode sale;
- stock deduction after completed sale only;
- cash and transfer payment;
- receipt preview/printing;
- sales history and void flow;
- daily reports;
- close shift and return to login;
- application restart with local SQLite data preserved.

## 9. Release rule

Do not create the public v0.3.0 installer/release until the Windows UI and license tests above pass. After QA, create the tag/release and test the generated NSIS `.exe` and MSI on a clean Windows machine.
