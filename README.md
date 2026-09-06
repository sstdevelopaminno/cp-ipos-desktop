# CpIPOS Desktop

Standalone Windows offline-first POS. This repository remains separate from CpIPOS Web and must not depend on Supabase, Vercel or any cloud API to complete a local sale.

Status: development prototype, not production-ready.

## Current foundation

- Tauri 2 Windows shell with React, TypeScript and Vite.
- SQLite local database through `@tauri-apps/plugin-sql`.
- CpIPOS branded splash, login, shift validation and desktop navigation.
- Sales screen with product grid and keyboard-wedge barcode scanning.
- Cart increase, decrease, remove and cancel-bill approval flow.
- Cash payment modal with numeric keypad and change calculation.
- Transfer payment records cashier manual confirmation only. It does not verify bank or gateway receipt.
- Receipt modal and reprint from persisted SQLite sale data.
- Sales history, daily reports, product management, stock movement history, employee management and local settings.
- Product images are stored as local media references under app data `media/products/`, not as large binaries in product rows.
- Local audit history for login, shift, sale, cancellation, product, stock and settings actions.

## Run on Windows

Prerequisites: Node.js 22.12+ or Node 24, npm, Rust stable MSVC, Microsoft C++ Build Tools, Windows SDK and WebView2 Runtime.

```powershell
npm install
npm run desktop:dev
```

Build installer:

```powershell
npm run desktop:build
```

## Payment rules

Cash is a local cash transaction. Transfer is manual payment-method recording by the cashier. PromptPay, transfer and card flows do not verify money received from a bank, card terminal or payment gateway.

## Security note

The current development PIN is temporary/demo-only and is not secure production authentication. Secure PIN hashing remains a separate required task before production use.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Retail POS](docs/RETAIL_POS.md)
- [Audit](docs/AUDIT.md)
- [Device management](docs/DEVICE_MANAGEMENT.md)
- [Roadmap](docs/ROADMAP.md)
- [Phase 0 bootstrap](docs/BOOTSTRAP.md)

## Repository rule

Work only in `E:\cp-ipos-desktop`. Do not move this project into the CpIPOS Web monorepo. Do not configure a remote or push unless explicitly requested.