# Audit And Activity Log

CpIPOS Desktop keeps a local audit history in SQLite table `audit_events`.

Recorded actions include:

- LOGIN
- LOGOUT
- SHIFT_OPEN
- SHIFT_CLOSE
- SALE_COMPLETED
- SALE_CANCELLED
- SALE_VOIDED
- CART_ITEM_REMOVED
- PRODUCT_CREATED
- PRODUCT_UPDATED
- PRICE_CHANGED
- STOCK_IN
- STOCK_OUT
- ADJUSTMENT
- SALE
- SALE_VOID_RETURN
- SETTINGS_CHANGED
- EMPLOYEE_CREATED
- EMPLOYEE_UPDATED
- EMPLOYEE_DELETED

Minimum fields are id, timestamp, employee id/code, role, action, entity type/id, shift id, device id, reason, status and details JSON.

PIN and password values must never be written to audit details. Employee PINs are stored as salted PBKDF2-SHA256 hashes; legacy plaintext demo PIN rows are upgraded and cleared automatically during initialization or successful legacy login.

Financial and stock history must not be silently deleted or rewritten. Completed sale void keeps the original sale and adds an audit trail plus optional compensating stock movement.
