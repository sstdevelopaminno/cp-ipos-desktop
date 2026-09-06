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
Sales / Receipt / Stock / Audit / Settings
```

## Offline invariant

Creating a sale, taking payment, scanning barcode, managing cart, opening or closing shift, writing stock movement, reading sales history and showing reports must not require Internet, Vercel, Supabase or a remote API.

## Retail foundation

The desktop app now has a CpIPOS splash, restored local session flow, shift validation, main navigation and local sections for Sales, Products and Stock, Sales History, Reports, Employees and Settings.

Barcode scanners are treated as keyboard-wedge input. A completed barcode lookup reads local SQLite products and adds or increments the cart item. Unknown barcodes show a local popup.

Checkout remains behind an explicit payment flow. Cash requires a numeric payment modal and blocks confirmation until received amount is enough. Transfer records cashier manual confirmation only and never claims bank or gateway verification.

## Data boundaries

React components call `PosRepository`; raw SQL belongs in repository implementations. Product images are saved under the app local data directory and the product row stores only a relative media reference.

Sale checkout uses one `INSERT` into `sales`. SQLite triggers expand line items, create stock sale movements and record the sale audit event in the same database statement.

## Security limits

The current PIN is demo-only and not production secure authentication. The employee model keeps a credential abstraction so secure hashing can replace `pin_demo` later. Sensitive actions such as bill cancellation already require local re-authentication and role checks.

## Future boundaries

- Secure PIN hashing.
- Real printer integration.
- Backup and restore implementation.
- Optional cloud/device management after local transaction commit.
- Windows enterprise MDM integration as a separate layer.

This application is not production-ready.