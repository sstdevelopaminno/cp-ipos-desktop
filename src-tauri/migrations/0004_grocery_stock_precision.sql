-- Grocery checkout precision and stock-safety hardening.
-- Forward-only migration: keep historical sales and ledgers intact.

DROP TRIGGER IF EXISTS sales_expand_items;
DROP TRIGGER IF EXISTS sales_payment_receipt_ledger_v3;
DROP TRIGGER IF EXISTS sales_validate_stock_v4;
DROP TRIGGER IF EXISTS sales_checkout_v4;

CREATE TRIGGER sales_validate_stock_v4
BEFORE INSERT ON sales
WHEN NEW.status = 'completed'
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM (
      SELECT
        json_extract(value,'$.productId') AS product_id,
        SUM(CAST(json_extract(value,'$.quantity') AS REAL)) AS required_qty
      FROM json_each(NEW.items_json)
      GROUP BY json_extract(value,'$.productId')
    ) requested
    LEFT JOIN products p ON p.id = requested.product_id
    WHERE p.id IS NULL
       OR p.active <> 1
       OR requested.required_qty <= 0
       OR ROUND(CAST(p.stock_quantity AS REAL), 3) < ROUND(requested.required_qty, 3)
  ) THEN RAISE(ABORT, 'INSUFFICIENT_STOCK') END;
END;

CREATE TRIGGER sales_checkout_v4
AFTER INSERT ON sales
WHEN NEW.status = 'completed'
BEGIN
  INSERT INTO sale_items(id,sale_id,product_id,name,quantity,unit_price,line_total)
  SELECT
    lower(hex(randomblob(16))),
    NEW.id,
    json_extract(value,'$.productId'),
    json_extract(value,'$.name'),
    ROUND(CAST(json_extract(value,'$.quantity') AS REAL), 3),
    ROUND(CAST(json_extract(value,'$.unitPrice') AS REAL), 2),
    ROUND(
      CAST(json_extract(value,'$.quantity') AS REAL) *
      CAST(json_extract(value,'$.unitPrice') AS REAL),
      2
    )
  FROM json_each(NEW.items_json);

  INSERT OR IGNORE INTO payments(id,sale_id,method,amount,received,change_amount,status,created_at)
  VALUES(
    lower(hex(randomblob(16))), NEW.id, NEW.payment_method,
    ROUND(NEW.total,2), ROUND(NEW.paid,2), ROUND(NEW.change_amount,2),
    'recorded', NEW.created_at
  );

  INSERT OR IGNORE INTO receipts(id,sale_id,receipt_no,receipt_label,language,created_at)
  VALUES(lower(hex(randomblob(16))), NEW.id, NEW.receipt_no, NEW.receipt_no, 'th', NEW.created_at);

  INSERT INTO stock_movement_ledger(
    id,product_id,sku,name,movement_type,quantity,before_quantity,after_quantity,
    unit_cost,reason,employee_id,shift_id,created_at
  )
  SELECT
    lower(hex(randomblob(16))),
    p.id,
    COALESCE(p.product_code,p.sku),
    COALESCE(p.name_th,p.name),
    'SALE',
    requested.required_qty,
    ROUND(CAST(p.stock_quantity AS REAL),3),
    ROUND(CAST(p.stock_quantity AS REAL) - requested.required_qty,3),
    p.cost,
    'SALE_COMPLETED ' || NEW.receipt_no,
    NEW.employee_id,
    NEW.shift_id,
    NEW.created_at
  FROM (
    SELECT
      json_extract(value,'$.productId') AS product_id,
      ROUND(SUM(CAST(json_extract(value,'$.quantity') AS REAL)),3) AS required_qty
    FROM json_each(NEW.items_json)
    GROUP BY json_extract(value,'$.productId')
  ) requested
  JOIN products p ON p.id = requested.product_id;

  UPDATE products
  SET stock_quantity = ROUND(CAST(stock_quantity AS REAL) - (
        SELECT COALESCE(SUM(CAST(json_extract(value,'$.quantity') AS REAL)),0)
        FROM json_each(NEW.items_json)
        WHERE json_extract(value,'$.productId') = products.id
      ), 3),
      updated_at = CURRENT_TIMESTAMP
  WHERE id IN (
    SELECT json_extract(value,'$.productId') FROM json_each(NEW.items_json)
  );

  INSERT INTO audit_events(
    id,timestamp,employee_id,employee_code,role,action,entity_type,entity_id,
    shift_id,device_id,reason,status,details_json
  )
  VALUES(
    lower(hex(randomblob(16))), NEW.created_at, NEW.employee_id, NEW.employee_code,
    NULL, 'SALE_COMPLETED', 'sale', NEW.id, NEW.shift_id, NEW.device_id,
    NULL, NEW.payment_method, NEW.items_json
  );
END;
