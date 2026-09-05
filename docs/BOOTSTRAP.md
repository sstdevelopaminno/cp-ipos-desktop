# Phase 0 bootstrap verification

Started: 2026-09-05 (Asia/Bangkok)
Completed: 2026-09-06 (Asia/Bangkok)
Workspace: `E:\cp-ipos-desktop`
Status: Phase 0 bootstrap verified; development prototype, not production-ready.

## Boundary

This is a standalone Git repository on `main`. No remote or submodule was configured. No CpIPOS Web repository was inspected or modified during Phase 0. Do not move this project into the Web monorepo or introduce cloud dependencies into the offline sales critical path.

## Toolchain observed

- Node.js: v24.13.0
- npm: 11.6.2
- rustc: 1.96.0 (ac68faa20 2026-05-25)
- cargo: 1.96.0 (30a34c682 2026-05-25)
- Rust target/toolchain: stable-x86_64-pc-windows-msvc
- Visual Studio 2022 Build Tools: C++ x86/x64 component detected
- Windows SDK: 10.0.26100.0
- WebView2 Runtime: 152.0.4191.62
- GitHub Actions uses Node 22; local verification uses Node 24.

## Installation and verification

Dependencies were installed with `npm install --cache .bootstrap-cache/npm`.
The existing dependency major ranges were retained; missing `@types/node@^22` was added to support the Vite config and match the CI Node major.
`package-lock.json` is retained and GitHub Actions now uses `npm ci`.

| Check | Result | Evidence |
| --- | --- | --- |
| npm install | PASS | 30 packages audited after adding Node types; 0 vulnerabilities reported |
| npm run build | PASS | TypeScript and Vite completed with exit code 0 |
| cargo check --manifest-path src-tauri/Cargo.toml | PASS | Finished `dev` profile in 40m 25s |
| npm run desktop:dev | PASS | Native Tauri app launched as `CpIPOS Desktop`; first full build finished in 42m 06s, restart build finished in 5m 01s |
| Native login, shift, POS/cart, CASH sale | PASS | Login screen loaded, demo PIN `1234` worked, shift screen opened, POS rendered, `น้ำเปล่า` was added to cart, CASH sale completed |
| SQLite persistence after restart | PASS | Receipt `R30081698` remained in `C:\Users\Admins\AppData\Roaming\th.co.cuttingpoint.cpipos.desktop\cpipos.db` after app restart |
| Offline transaction without Internet/Supabase/Vercel | PASS | CASH sale completed while WebView network emulation was offline; network log showed only Vite localhost assets and `ipc.localhost/plugin:sql` calls |

Rust dependency cache was scoped to this workspace for this run:
`$env:CARGO_HOME = 'E:\cp-ipos-desktop\.bootstrap-cache\cargo'`.

## Verified local sale

`R30081698` was written to the native SQLite database with `payment_method = cash`, `total = 15`, `paid = 15`, `change_amount = 0`, and one `sale_items` row for `น้ำเปล่า` at `15`.

## Initial build errors (verbatim, subsequently resolved)

```text
tsconfig.node.json(7,35): error TS5096: Option 'allowImportingTsExtensions' can only be used when either 'noEmit' or 'emitDeclarationOnly' is set.
vite.config.ts(4,14): error TS2580: Cannot find name 'process'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node`.
```

The scaffold also lacked the default Windows resource icon required by tauri-build. Added minimal C placeholder assets at `src-tauri/icons/icon.ico` (32/48/256px) and `src-tauri/icons/icon.png` (128px). These are bootstrap assets, not final branding.

Fixes: set `noEmit: true` in `tsconfig.node.json`; add Node type definitions. Removed only generated `vite.config.js` and `vite.config.d.ts` from the failed emitting build.

## Native acceptance checklist

- [x] Application launches as CpIPOS Desktop.
- [x] Login screen loads and demo PIN works.
- [x] Open/close shift works.
- [x] POS renders and products can be added to the cart.
- [x] CASH sale completes.
- [x] Sale and sale items are stored in SQLite and survive restart.
- [x] Transaction works without Internet/Supabase/Vercel APIs.

Development server startup or browser fallback alone does not satisfy these checks.

## Release gate

Commit only appropriate source, config, docs and lockfiles after successful bootstrap verification. No push unless an explicitly configured new standalone `cp-ipos-desktop` remote exists.
Phase 0 does not implement secure PIN, receipts/reprint, history, backup/restore, sync, printers, updater or UI refactoring.