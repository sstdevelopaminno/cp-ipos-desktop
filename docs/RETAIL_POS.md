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

Adding to cart does not decrement stock. Removing cart items and cancelling a pre-payment cart write audit records only. Stock decrements after final checkout commit. Successful checkout records sale, sale items, payment, receipt, stock movement and audit data locally.

Stock is treated as a ledger. Historical movement rows are not rewritten. Manual movement types are `STOCK_IN`, `STOCK_OUT` and `ADJUSTMENT`; sale flows add `SALE`; returned goods from voided sales add `SALE_VOID_RETURN`.

## Payment

Cash requires the received amount to be at least the total and calculates change locally.

Transfer, PromptPay and Card in V0.1 are payment-method recording only. They do not verify that money was actually received from a bank, PromptPay gateway, card terminal or payment gateway.

## Receipt and history

A successful sale opens a Unicode-safe local receipt modal. Reprint loads the same sale from SQLite. Labels are localizable for Thai/English. Thermal Thai font and printer hardware behavior remain later hardware work.

Sales history keeps the original completed sale. Voiding a completed sale requires authorized PIN and reason, marks the sale cancelled, writes audit, and optionally creates returned-stock ledger movements.

## Verification targets

Development verification should cover splash on launch, login, shift gate, close/relaunch session behavior, close-shift-to-login, product modal, duplicate barcode block, Thai text persistence after restart, cart scan no-stock-change, completed sale stock decrement once, failed checkout/cancel no-stock-change, sale void return movement, language switch and no external Internet/Supabase/Vercel dependency.

## UI polish baseline

The desktop shell now uses one CpIPOS blue/white visual system for splash, login, shift, sales, payment, product, stock, history, reports, employees and settings screens. Controls are sized for touch, the cart remains visible during product browsing, checkout opens a payment selection modal first, and cash entry uses quick amounts plus a numeric keypad.

Reports use the workspace body as the vertical scroll area on shorter desktop screens. The sales trend chart is opened from the top reports action as a modal popup, keeping the main report view compact. The left navigation can also scroll internally while keeping close-shift and logout actions available at the bottom.

Barcode scan input keeps focus after successful scans, unknown scans and completed payments. Unknown barcode flow preserves the scanned code and pre-fills Add Product.

Settings uses section navigation and marks backup/restore and remote management as not ready instead of showing fake success.
