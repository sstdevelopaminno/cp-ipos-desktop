ALTER TABLE products ADD COLUMN product_code TEXT;
ALTER TABLE products ADD COLUMN name_th TEXT;
ALTER TABLE products ADD COLUMN name_en TEXT;
ALTER TABLE products ADD COLUMN quantity_scale REAL NOT NULL DEFAULT 1;
ALTER TABLE sales ADD COLUMN void_restock INTEGER NOT NULL DEFAULT 0;

UPDATE products SET product_code = COALESCE(NULLIF(product_code,''), sku), name_th = COALESCE(NULLIF(name_th,''), name);
UPDATE products SET name_th='กะเพราหมูสับ', name='กะเพราหมูสับ', category_name='อาหารตามสั่ง', unit='จาน' WHERE id='p1';
UPDATE products SET name_th='กะเพราไก่', name='กะเพราไก่', category_name='อาหารตามสั่ง', unit='จาน' WHERE id='p2';
UPDATE products SET name_th='ข้าวผัดหมู', name='ข้าวผัดหมู', category_name='อาหารตามสั่ง', unit='จาน' WHERE id='p3';
UPDATE products SET name_th='ก๋วยเตี๋ยวน้ำใส', name='ก๋วยเตี๋ยวน้ำใส', category_name='ก๋วยเตี๋ยว', unit='ชาม' WHERE id='p4';
UPDATE products SET name_th='ก๋วยเตี๋ยวต้มยำ', name='ก๋วยเตี๋ยวต้มยำ', category_name='ก๋วยเตี๋ยว', unit='ชาม' WHERE id='p5';
UPDATE products SET name_th='อเมริกาโน่', name='อเมริกาโน่', category_name='กาแฟ', unit='แก้ว' WHERE id='p6';
UPDATE products SET name_th='ลาเต้', name='ลาเต้', category_name='กาแฟ', unit='แก้ว' WHERE id='p7';
UPDATE products SET name_th='ชาไทย', name='ชาไทย', category_name='เครื่องดื่ม', unit='แก้ว' WHERE id='p8';
UPDATE products SET name_th='น้ำเปล่า', name='น้ำเปล่า', category_name='เครื่องดื่ม', unit='ขวด' WHERE id='p9';
UPDATE staff SET display_name='ผู้ดูแลร้าน' WHERE id='staff-owner';
UPDATE app_settings SET value='ขอบคุณที่ใช้บริการ' WHERE key='receiptFooter';
UPDATE app_settings SET value='ยังไม่ได้ตั้งค่าเครื่องพิมพ์' WHERE key='printerType';
INSERT OR IGNORE INTO app_settings(key,value) VALUES('language','th');

CREATE UNIQUE INDEX IF NOT EXISTS products_product_code_unique ON products(product_code) WHERE product_code IS NOT NULL AND product_code <> '';
CREATE UNIQUE INDEX IF NOT EXISTS products_barcode_unique ON products(barcode) WHERE barcode IS NOT NULL AND barcode <> '';
CREATE INDEX IF NOT EXISTS products_barcode_idx ON products(barcode);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY, sale_id TEXT NOT NULL UNIQUE REFERENCES sales(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK(method IN ('cash','transfer','promptpay','card')),
  amount REAL NOT NULL, received REAL NOT NULL, change_amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'recorded', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS receipts (
  id TEXT PRIMARY KEY, sale_id TEXT NOT NULL UNIQUE REFERENCES sales(id) ON DELETE CASCADE,
  receipt_no TEXT NOT NULL, receipt_label TEXT NOT NULL, language TEXT NOT NULL DEFAULT 'th', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS stock_movement_ledger (
  id TEXT PRIMARY KEY, product_id TEXT NOT NULL, sku TEXT NOT NULL, name TEXT NOT NULL,
  movement_type TEXT NOT NULL CHECK(movement_type IN ('STOCK_IN','SALE','STOCK_OUT','ADJUSTMENT','SALE_VOID_RETURN')),
  quantity REAL NOT NULL, before_quantity REAL NOT NULL, after_quantity REAL NOT NULL,
  unit_cost REAL NOT NULL DEFAULT 0, reason TEXT, employee_id TEXT, shift_id TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS stock_movement_ledger_product_idx ON stock_movement_ledger(product_id, created_at);

INSERT OR IGNORE INTO stock_movement_ledger(id,product_id,sku,name,movement_type,quantity,before_quantity,after_quantity,unit_cost,reason,employee_id,shift_id,created_at)
  SELECT id,product_id,sku,name,
    CASE movement_type WHEN 'in' THEN 'STOCK_IN' WHEN 'out' THEN 'STOCK_OUT' WHEN 'adjustment' THEN 'ADJUSTMENT' WHEN 'sale' THEN 'SALE' ELSE 'ADJUSTMENT' END,
    CAST(quantity AS REAL),CAST(before_quantity AS REAL),CAST(after_quantity AS REAL),unit_cost,reason,employee_id,shift_id,created_at
  FROM stock_movements;

CREATE TRIGGER IF NOT EXISTS sales_payment_receipt_ledger_v3
AFTER INSERT ON sales
WHEN NEW.status = 'completed'
BEGIN
  INSERT OR IGNORE INTO payments(id,sale_id,method,amount,received,change_amount,status,created_at)
  VALUES(lower(hex(randomblob(16))), NEW.id, NEW.payment_method, NEW.total, NEW.paid, NEW.change_amount, 'recorded', NEW.created_at);

  INSERT OR IGNORE INTO receipts(id,sale_id,receipt_no,receipt_label,language,created_at)
  VALUES(lower(hex(randomblob(16))), NEW.id, NEW.receipt_no, NEW.receipt_no, 'th', NEW.created_at);

  INSERT OR IGNORE INTO stock_movement_ledger(id,product_id,sku,name,movement_type,quantity,before_quantity,after_quantity,unit_cost,reason,employee_id,shift_id,created_at)
  SELECT lower(hex(randomblob(16))), p.id, COALESCE(p.product_code,p.sku), COALESCE(p.name_th,p.name), 'SALE',
         CAST(json_extract(value,'$.quantity') AS REAL), p.stock_quantity,
         ROUND(p.stock_quantity - CAST(json_extract(value,'$.quantity') AS REAL), 3), p.cost,
         'SALE_COMPLETED ' || NEW.receipt_no, NEW.employee_id, NEW.shift_id, NEW.created_at
  FROM json_each(NEW.items_json) JOIN products p ON p.id = json_extract(value,'$.productId');
END;

CREATE TRIGGER IF NOT EXISTS sales_void_ledger_v3
AFTER UPDATE OF status ON sales
WHEN OLD.status = 'completed' AND NEW.status = 'cancelled'
BEGIN
  INSERT INTO stock_movement_ledger(id,product_id,sku,name,movement_type,quantity,before_quantity,after_quantity,unit_cost,reason,employee_id,shift_id,created_at)
  SELECT lower(hex(randomblob(16))), p.id, COALESCE(p.product_code,p.sku), COALESCE(p.name_th,p.name), 'SALE_VOID_RETURN',
         CAST(si.quantity AS REAL), p.stock_quantity, ROUND(p.stock_quantity + CAST(si.quantity AS REAL), 3), p.cost,
         NEW.cancelled_reason, NEW.cancelled_by, NEW.shift_id, NEW.cancelled_at
  FROM sale_items si JOIN products p ON p.id = si.product_id
  WHERE si.sale_id = NEW.id AND NEW.void_restock = 1;

  UPDATE products SET stock_quantity = ROUND(stock_quantity + (
    SELECT COALESCE(SUM(CAST(si.quantity AS REAL)),0) FROM sale_items si WHERE si.sale_id = NEW.id AND si.product_id = products.id
  ), 3), updated_at = CURRENT_TIMESTAMP
  WHERE NEW.void_restock = 1 AND id IN (SELECT product_id FROM sale_items WHERE sale_id = NEW.id);

  INSERT INTO audit_events(id,timestamp,employee_id,employee_code,role,action,entity_type,entity_id,shift_id,device_id,reason,status,details_json)
  VALUES(lower(hex(randomblob(16))), NEW.cancelled_at, NEW.cancelled_by, NEW.employee_code, NULL, 'SALE_VOIDED', 'sale', NEW.id, NEW.shift_id, NEW.device_id, NEW.cancelled_reason, CASE WHEN NEW.void_restock = 1 THEN 'SALE_VOID_RETURN' ELSE 'VOID_ONLY' END, NEW.items_json);
END;
