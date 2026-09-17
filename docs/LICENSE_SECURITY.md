# CpIPOS Desktop Offline License Security

## Goal

CpIPOS Desktop remains an offline-first Windows POS. A customer can use the program in trial/test mode for 30 days. After the trial expires, selling is locked until the machine receives a valid license issued by CUTTING POINT TECH CO., LTD. IT.

The production license verifier is native Rust/Tauri code. The application does not need the internet to verify a license.

## Trust model

CpIPOS uses Ed25519 asymmetric signatures.

- The IT-side private key signs licenses.
- The customer application contains only the public key.
- The private key must never be committed to Git, copied to customer PCs, embedded in the installer, or stored in frontend JavaScript.
- A customer may read the public key, but the public key cannot create a valid IT signature.

The production public key is stored in `src-tauri/license_public_key.b64` or supplied at compile time as `CPIPOS_LICENSE_PUBLIC_KEY_B64`.

## Device binding

Each Windows device gets a stable CpIPOS fingerprint derived from the Windows MachineGuid and SHA-256. The displayed format is similar to:

`CPD-12345678-90ABCDEF-12345678-90ABCDEF`

A signed license contains an explicit list of allowed fingerprints and a `deviceLimit`.

Examples:

- 1-device license: `deviceLimit=1`, one approved fingerprint.
- 2-device license: `deviceLimit=2`, two approved fingerprints.

For a completely offline product, a generic transferable "2-seat" key cannot reliably prevent copying to ten independent PCs because those PCs cannot coordinate usage. Therefore CpIPOS enforces offline seat count by requiring IT to list every approved device fingerprint in the signed license.

## Trial enforcement

Trial duration is 30 days from first native launch.

Trial state is mirrored in two local locations:

1. CpIPOS app-data license state file.
2. Windows HKCU registry under `Software\\CuttingPointTech\\CpIPOS`.

The verifier keeps the earliest recorded installation time and latest recorded seen time. A large system-clock rollback locks selling temporarily until the clock is corrected or a suitable license is installed.

After a machine has successfully activated once, deleting the stored license does not return that machine to trial mode; selling remains locked until a valid signed license is restored.

## Generate the IT authority key pair

Run once on a trusted IT computer:

```powershell
node scripts/license-it-tool.mjs init
```

Default outputs:

- Private key: `secrets/license-it/license-private.pem`
- Public key: `src-tauri/license_public_key.b64`

The repository already ignores `*.pem`, `*.key`, `secrets/`, and related secret formats. The private key still needs an encrypted offline backup controlled by company IT.

After generating or changing the public key, rebuild the customer application.

## Issue a license

Collect the machine fingerprint shown in CpIPOS Settings > Program License or on the lock screen.

One device:

```powershell
node scripts/license-it-tool.mjs issue `
  --license-id CPT-2026-0001 `
  --customer "Customer Shop" `
  --devices CPD-12345678-90ABCDEF-12345678-90ABCDEF `
  --device-limit 1 `
  --expires lifetime `
  --out secrets/license-it/CPT-2026-0001.cpipos
```

Two devices:

```powershell
node scripts/license-it-tool.mjs issue `
  --license-id CPT-2026-0002 `
  --customer "Customer Branches" `
  --devices CPD-AAAA...,CPD-BBBB... `
  --device-limit 2 `
  --expires 2027-12-31T23:59:59+07:00 `
  --out secrets/license-it/CPT-2026-0002.cpipos
```

The customer pastes the resulting `CPIPOS1....` value into the application. Verification is local and does not contact a license server.

## What this protects against

This design materially improves protection against:

- inventing arbitrary license strings;
- changing customer/device/expiry fields inside a license;
- copying a one-device license to an unapproved PC;
- copying a two-device license to a third PC;
- deleting a previously activated license to regain the original trial;
- basic system-clock rollback during trial or time-limited licensing.

## Limits of a fully offline application

No normal desktop application can be guaranteed impossible to patch when an attacker has administrator access, can replace the executable, can modify memory, or can reverse engineer the binary. Digital signatures prevent license forgery; they do not make the executable itself mathematically unpatchable.

For stronger commercial hardening before broad customer release:

1. Code-sign the Windows installer and application binary.
2. Keep the GitHub repository private before adding commercial secrets or unreleased business logic.
3. Move final sale/database mutation behind Rust commands that also call the native license verifier, instead of allowing all writes directly from frontend code.
4. Reduce SQL plugin write permissions once native sale commands are in place.
5. Consider optional online activation/MDM for customers who need floating-seat licensing, revocation, or remote device replacement.

## Release rule

Development pushes must not publish customer installers. Windows customer releases are created only by an explicit workflow dispatch or a `v*` tag.
