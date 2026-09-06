# CpIPOS Desktop

Standalone Windows offline-first POS. This repository remains separate from CpIPOS Web and must not depend on Supabase, Vercel or any cloud API to complete a local sale.

Status: development prototype, not production-ready.

## Current foundation

- Tauri 2 Windows shell with React, TypeScript, Vite and local SQLite.
- CpIPOS branded splash on every launch, PIN login, shift gate and desktop navigation.
- Sales screen with product grid, keyboard-wedge barcode scan, cart quantity editing and local-only checkout.
- Product create/edit uses a touch-friendly modal with user-editable `product_code`, barcode, Thai/English names, grocery units, stock limits, image reference and active flag.
- Barcode and product-code uniqueness are checked locally. Duplicate barcode lookup opens the existing product instead of assigning the same barcode twice.
- Cart actions do not decrement stock. Stock decrements only when a sale is successfully completed and recorded locally.
- Cash, transfer, PromptPay and card are stored as payment methods. PromptPay and card in V0.1 are payment-method recording only and do not verify that money was received from any gateway.
- Receipt modal, receipt reprint, sales history, daily reports, stock ledger, employee foundation, settings, language switch and local audit history are available for development verification.
- Product images are stored as local media references under app data `media/products/`, not as large binaries in product rows.

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

Cash is a local cash transaction. Transfer, PromptPay and Card in V0.1 are payment-method recording only. They do not verify bank transfer, PromptPay status, card terminal approval or gateway receipt.

## Security note

The current development PIN is temporary/demo-only and must not be considered secure authentication. Secure PIN hashing remains a required Phase 1 task before production use.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Retail POS](docs/RETAIL_POS.md)
- [Audit](docs/AUDIT.md)
- [Device management](docs/DEVICE_MANAGEMENT.md)
- [Roadmap](docs/ROADMAP.md)
- [Phase 0 bootstrap](docs/BOOTSTRAP.md)

## Repository rule

Work only in `E:\cp-ipos-desktop`. Do not move this project into the CpIPOS Web monorepo. Do not configure a remote or push unless explicitly requested.
