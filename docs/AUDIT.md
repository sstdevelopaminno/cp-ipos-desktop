# Audit And Activity Log

CpIPOS Desktop keeps a local audit history in SQLite table `audit_events`.

Recorded actions include:

- LOGIN
- LOGOUT
- SHIFT_OPEN
- SHIFT_CLOSE
- SALE_COMPLETED
- SALE_CANCELLED
- CART_ITEM_REMOVED
- PRODUCT_CREATED
- PRODUCT_UPDATED
- PRICE_CHANGED
- STOCK_IN
- STOCK_OUT
- STOCK_ADJUSTMENT
- SETTINGS_CHANGED

Minimum fields are id, timestamp, employee id/code, role, action, entity type/id, shift id, device id, reason, status and details JSON.

PIN and password values must never be written to audit details. Current PIN verification is demo-only; production secure hashing remains a later task.

Financial and stock history must not be silently deleted. Data cleanup requires explicit authorization and backup/restore support.