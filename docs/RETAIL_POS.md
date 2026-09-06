# Retail POS Foundation

CpIPOS Desktop is offline-first. Sales, barcode lookup, product management, stock movements, receipts and reports read and write local SQLite data.

## Startup

The application launches with the CpIPOS logo, initializes local database/settings, restores a saved local employee session when present, validates the active shift, then opens Sales. Without a valid local session it shows PIN login first. Without an active shift it shows the shift screen before Sales.

## Sales

The Sales screen supports product grid selling and keyboard-wedge barcode scanning. A scanned barcode is looked up locally. Found products are added to the cart or incremented. Unknown barcodes show a local popup and can route the cashier to product creation.

## Cart

Cart rows support quantity increase, decrease and remove. Removing an item records a `CART_ITEM_REMOVED` audit event. Cancelling a bill requires employee PIN re-authentication, Owner or Manager role, a reason and confirmation. The app stores a cancellation/audit record before clearing the cart.

## Payment

Cash opens a numeric keypad modal. Confirmation is disabled until received amount is at least the total. Change is calculated from local integer-rounded money values.

Transfer opens a manual confirmation modal. It records `payment_method = transfer`, paid amount equal to total and an explicit cashier warning. It does not verify PromptPay, bank transfer, card terminal or payment gateway receipt.

## Receipt

A successful sale opens a receipt modal. Reprint opens the same receipt from persisted SQLite sales and sale_items data. Printer hardware is not implemented; print buttons are clearly shown as not configured.