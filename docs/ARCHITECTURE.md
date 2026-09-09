# CpIPOS Desktop Architecture

```text
React CpIPOS Desktop UI
      |
  PosRepository
      |
TauriRepository -------- BrowserRepository (UI-only development)
      |
SQLite cpipos.db + local AppData media
      |
Sales / Payments / Receipts / Stock Ledger / Audit / Settings
```

## Offline invariant

Creating a sale, taking payment-method input, scanning barcode, managing cart, opening or closing shift, writing stock movement, reading sales history and showing reports must not require Internet, Vercel, Supabase or a remote API.

## Retail foundation

The desktop app has a CpIPOS splash, restored local session flow, shift validation, main navigation and local sections for Sales, Products and Stock, Sales History, Reports, Employees and Settings.

Barcode scanners are treated as keyboard-wedge input. Barcode values are normalized and looked up in local SQLite. Duplicate barcode assignment is blocked and the UI can open the existing product.

Products use a user-facing `product_code`; UUIDs remain internal. Product records store Thai name plus optional English name, grocery unit, decimal-capable quantity, stock thresholds, active flag and local image reference.

Checkout remains behind an explicit payment flow. Cash requires enough received cash. Transfer, PromptPay and Card are payment-method recording only in V0.1; no gateway confirms receipt of funds.

## Data boundaries

React components call `PosRepository`; raw SQL belongs in repository implementations. Product images are saved under the app local data directory and the product row stores only a relative media reference.

A successful checkout writes the sale locally, expands items, records payment/receipt rows, writes stock ledger/audit data and updates inventory. Adding items to cart never decrements stock.

Completed sale void keeps the original sale row and changes its status to cancelled with authorization, reason and audit trail. When returned goods are accepted, a compensating `SALE_VOID_RETURN` ledger movement is written; historical movements are not rewritten.

## Localization

The UI uses Thai/English dictionaries from one screen set. Settings includes `Language / ภาษา`; changing it refreshes labels without duplicating screens. SQLite must preserve Unicode Thai for products, employees, receipts, reports, audit and settings.

## Security limits

Employee PINs are stored as salted PBKDF2-SHA256 hashes in SQLite after initialization; legacy `pin_demo` values are upgraded and cleared automatically. Sensitive actions such as bill cancellation and sale void require local re-authentication. The first default owner PIN remains an onboarding credential and must be changed before real use.

## Future boundaries

- Secure PIN hashing.
- Real printer integration.
- Backup and restore implementation.
- Optional cloud/device management after local transaction commit.
- Windows enterprise MDM integration as a separate layer.

This application is not production-ready.
