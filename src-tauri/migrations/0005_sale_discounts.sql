-- Persist whole-bill discount metadata without changing the existing stock/payment transaction path.
-- GrocerySalesScreen sends originalUnitPrice + discount metadata inside items_json while the
-- normal unitPrice remains the net unit price used by checkout totals and payment records.

CREATE TABLE IF NOT EXISTS sale_discounts (
  sale_id TEXT PRIMARY KEY REFERENCES sales(id) ON DELETE CASCADE,
  subtotal REAL NOT NULL CHECK(subtotal >= 0),
  discount_amount REAL NOT NULL CHECK(discount_amount >= 0),
  discount_type TEXT NOT NULL CHECK(discount_type IN ('amount','percent')),
  discount_value REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sale_discounts_created_at ON sale_discounts(created_at);

DROP TRIGGER IF EXISTS sales_capture_discount_v5;
CREATE TRIGGER sales_capture_discount_v5
AFTER INSERT ON sales
WHEN NEW.status = 'completed'
BEGIN
  INSERT OR REPLACE INTO sale_discounts(
    sale_id, subtotal, discount_amount, discount_type, discount_value, created_at
  )
  SELECT
    NEW.id,
    ROUND(gross.subtotal, 2),
    ROUND(MAX(0, gross.subtotal - NEW.total), 2),
    CASE json_extract(NEW.items_json, '$[0].discountType')
      WHEN 'amount' THEN 'amount'
      WHEN 'percent' THEN 'percent'
      ELSE 'amount'
    END,
    ROUND(COALESCE(CAST(json_extract(NEW.items_json, '$[0].discountValue') AS REAL), 0), 2),
    NEW.created_at
  FROM (
    SELECT COALESCE(SUM(
      CAST(json_extract(value, '$.quantity') AS REAL) *
      CAST(COALESCE(
        json_extract(value, '$.originalUnitPrice'),
        json_extract(value, '$.unitPrice')
      ) AS REAL)
    ), 0) AS subtotal
    FROM json_each(NEW.items_json)
  ) gross
  WHERE ROUND(gross.subtotal - NEW.total, 2) > 0;

  INSERT INTO audit_events(
    id,timestamp,employee_id,employee_code,role,action,entity_type,entity_id,
    shift_id,device_id,reason,status,details_json
  )
  SELECT
    lower(hex(randomblob(16))), NEW.created_at, NEW.employee_id, NEW.employee_code,
    NULL, 'SALE_DISCOUNT_APPLIED', 'sale', NEW.id, NEW.shift_id, NEW.device_id,
    NULL, json_extract(NEW.items_json, '$[0].discountType'),
    json_object(
      'subtotal', ROUND(gross.subtotal, 2),
      'discountAmount', ROUND(MAX(0, gross.subtotal - NEW.total), 2),
      'discountType', json_extract(NEW.items_json, '$[0].discountType'),
      'discountValue', COALESCE(json_extract(NEW.items_json, '$[0].discountValue'), 0)
    )
  FROM (
    SELECT COALESCE(SUM(
      CAST(json_extract(value, '$.quantity') AS REAL) *
      CAST(COALESCE(
        json_extract(value, '$.originalUnitPrice'),
        json_extract(value, '$.unitPrice')
      ) AS REAL)
    ), 0) AS subtotal
    FROM json_each(NEW.items_json)
  ) gross
  WHERE ROUND(gross.subtotal - NEW.total, 2) > 0;
END;
