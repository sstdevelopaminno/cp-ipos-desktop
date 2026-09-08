# Retail POS Foundation

CpIPOS Desktop is offline-first. Sales, barcode lookup, product management, stock movements, receipts and reports read and write local SQLite data.

## Startup and shift flow

The application launches with the CpIPOS logo on every start, initializes local database/settings, restores a saved local employee session when present, validates the active shift, then opens Sales. Without a valid local session it shows PIN login first. Without an active shift it shows the shift screen before Sales.

Closing the Windows app does not close the shift. Closing shift is explicit: Sales -> Close Shift -> Shift Summary -> Confirm Close Shift -> persist closed shift -> clear employee POS session -> Login.

## Products and barcode

Product create/edit uses a large touch-friendly modal. User-facing fields are product code, barcode, Thai name, optional English name, category, selling price, cost, unit, current stock, minimum stock, image reference and active flag. UUIDs are internal and not shown as the product code.

Barcode scanner input is keyboard-wedge with Enter. Values are normalized before lookup. Duplicate barcode assignment is blocked locally; the UI shows the existing product and can open it for editing. Barcode and product code indexes live in SQLite.

Supported grocery units include piece-like Thai units plus `kg`, `g`, `liter` and `ml`. Quantity uses decimal values to support weighted goods; money is rounded to two decimals.

## Cart and stock accuracy

Adding to cart does not decrement stock. Removing cart items, parking bills and cancelling a pre-payment cart do not decrement stock; cancel writes audit records only. Parked bills are stored locally by device and shift, can be restored from a popup list, and stock decrements after final checkout commit. Successful checkout records sale, sale items, payment, receipt, stock movement and audit data locally.

Stock is treated as a ledger. Historical movement rows are not rewritten. Manual movement types are `STOCK_IN`, `STOCK_OUT` and `ADJUSTMENT`; sale flows add `SALE`; returned goods from voided sales add `SALE_VOID_RETURN`.

## Payment

Cash requires the received amount to be at least the total and calculates change locally.

Transfer, PromptPay and Card in V0.1 are payment-method recording only. They do not verify that money was actually received from a bank, PromptPay gateway, card terminal or payment gateway.

## Receipt and history

A successful sale opens a Unicode-safe local receipt modal. Reprint loads the same sale from SQLite. Labels are localizable for Thai/English. Printer setup is now a required first-run gate: CpIPOS detects Windows printers, chooses a default printer when available, requires one test print before normal use, and stores printer automation settings locally. After checkout, receipts are sent to the configured printer automatically. Cash payments also pulse the cash drawer automatically when enabled. Manual drawer opening is available from Sales but requires manager or owner PIN.

Sales history keeps the original completed sale. Voiding a completed sale requires authorized PIN and reason, marks the sale cancelled, writes audit, and optionally creates returned-stock ledger movements.

## Verification targets

Development verification should cover splash on launch, login, shift gate, close/relaunch session behavior, close-shift-to-login, product modal, duplicate barcode block, Thai text persistence after restart, cart scan no-stock-change, completed sale stock decrement once, failed checkout/cancel no-stock-change, sale void return movement, language switch and no external Internet/Supabase/Vercel dependency.

## Role policy

Staff users see only Sales, Sales History, Close Shift and Logout in the main shell. Manager and owner users see every main menu and can manage employees, settings, inventory and reports. Cancelling an unpaid bill remains available from Sales, but it must be authorized by a manager or owner PIN before the cancellation audit is written. Employee codes are limited to four characters, normalized to uppercase, and must stay unique. Demo PIN values are four numeric digits.

## UI polish baseline

The desktop shell now uses one CpIPOS blue/white visual system for splash, login, shift, sales, payment, product, stock, history, reports, employees and settings screens. Controls are sized for touch, the cart remains visible during product browsing, checkout opens a payment selection modal first, and cash entry uses quick amounts plus a numeric keypad.

Reports use the workspace body as the vertical scroll area on shorter desktop screens. The sales trend chart is opened from the top reports action as a modal popup, keeping the main report view compact. The left navigation can also scroll internally while keeping close-shift and logout actions available at the bottom.

Barcode scan input keeps focus after successful scans, unknown scans and completed payments. Unknown barcode flow preserves the scanned code and pre-fills Add Product.

Settings uses icon-based section cards. Each section opens in a modal, and backup/restore plus remote management remain marked as not ready instead of showing fake success. Settings now includes Program License / ลายเส้นโปรแกรม as a desktop-side activation contract: it can store the license key, CpIPOS-IT API URL, signed token placeholder, device limit, status and a short local device fingerprint, but it does not unlock by trusting a local fake key. Real activation must be verified by the CpIPOS-IT backend with a signed token and server-side device quota. The sidebar records the first detected viewport profile, applies the real visual viewport height, and keeps close-shift/logout actions locked inside the visible screen on short displays.
