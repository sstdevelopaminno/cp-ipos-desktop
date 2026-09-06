ALTER TABLE products ADD COLUMN barcode TEXT;
ALTER TABLE products ADD COLUMN cost REAL NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN unit TEXT NOT NULL DEFAULT 'ชิ้น';
ALTER TABLE products ADD COLUMN stock_quantity INTEGER NOT NULL DEFAULT 100;
ALTER TABLE products ADD COLUMN minimum_stock INTEGER NOT NULL DEFAULT 5;
ALTER TABLE products ADD COLUMN image_path TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS products_barcode_unique ON products(barcode) WHERE barcode IS NOT NULL AND barcode <> '';

UPDATE products SET barcode='8850000000011', cost=30, unit='จาน', stock_quantity=80, minimum_stock=10 WHERE id='p1' AND (barcode IS NULL OR barcode='');
UPDATE products SET barcode='8850000000028', cost=30, unit='จาน', stock_quantity=80, minimum_stock=10 WHERE id='p2' AND (barcode IS NULL OR barcode='');
UPDATE products SET barcode='8850000000035', cost=32, unit='จาน', stock_quantity=80, minimum_stock=10 WHERE id='p3' AND (barcode IS NULL OR barcode='');
UPDATE products SET barcode='8850000000042', cost=25, unit='ชาม', stock_quantity=80, minimum_stock=10 WHERE id='p4' AND (barcode IS NULL OR barcode='');
UPDATE products SET barcode='8850000000059', cost=28, unit='ชาม', stock_quantity=80, minimum_stock=10 WHERE id='p5' AND (barcode IS NULL OR barcode='');
UPDATE products SET barcode='8850000000066', cost=18, unit='แก้ว', stock_quantity=100, minimum_stock=15 WHERE id='p6' AND (barcode IS NULL OR barcode='');
UPDATE products SET barcode='8850000000073', cost=22, unit='แก้ว', stock_quantity=100, minimum_stock=15 WHERE id='p7' AND (barcode IS NULL OR barcode='');
UPDATE products SET barcode='8850000000080', cost=18, unit='แก้ว', stock_quantity=100, minimum_stock=15 WHERE id='p8' AND (barcode IS NULL OR barcode='');
UPDATE products SET barcode='8850000000097', cost=7, unit='ขวด', stock_quantity=120, minimum_stock=24 WHERE id='p9' AND (barcode IS NULL OR barcode='');

DROP TRIGGER IF EXISTS sales_expand_items;
CREATE TABLE IF NOT EXISTS sales_new (
  id TEXT PRIMARY KEY, receipt_no TEXT NOT NULL UNIQUE, total REAL NOT NULL,
  paid REAL NOT NULL, change_amount REAL NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL CHECK(payment_method IN ('cash','transfer','promptpay','card')),
  items_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('completed','cancelled')),
  employee_id TEXT, employee_code TEXT, cashier_name TEXT, shift_id TEXT, device_id TEXT,
  cancelled_at TEXT, cancelled_by TEXT, cancelled_reason TEXT
);
INSERT OR IGNORE INTO sales_new(id,receipt_no,total,paid,change_amount,payment_method,items_json,created_at,status)
  SELECT id,receipt_no,total,paid,change_amount,payment_method,items_json,created_at,'completed' FROM sales;
DROP TABLE sales;
ALTER TABLE sales_new RENAME TO sales;

CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
INSERT OR IGNORE INTO app_settings(key,value) VALUES
('storeName','CpIPOS Store'),('branchName','Main Branch'),('deviceName','POS-01'),('deviceId','desktop-pos-01'),
('receiptHeader','CpIPOS'),('taxId',''),('address',''),('phone',''),('receiptFooter','ขอบคุณที่ใช้บริการ'),
('ownerName','Owner'),('ownerPinNote','Demo-only owner PIN. Secure hashing is a later task.'),('printerType','ยังไม่ตั้งค่าเครื่องพิมพ์'),
('scannerMode','keyboard-wedge'),('remoteManagementEnabled','false'),('lastStorageReminderAt','');

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, employee_id TEXT, employee_code TEXT, role TEXT,
  action TEXT NOT NULL, entity_type TEXT, entity_id TEXT, shift_id TEXT, device_id TEXT,
  reason TEXT, status TEXT, details_json TEXT
);
CREATE INDEX IF NOT EXISTS audit_events_timestamp_idx ON audit_events(timestamp);

CREATE TABLE IF NOT EXISTS stock_movements (
  id TEXT PRIMARY KEY, product_id TEXT NOT NULL, sku TEXT NOT NULL, name TEXT NOT NULL,
  movement_type TEXT NOT NULL CHECK(movement_type IN ('in','out','adjustment','sale')),
  quantity INTEGER NOT NULL, before_quantity INTEGER NOT NULL, after_quantity INTEGER NOT NULL,
  unit_cost REAL NOT NULL DEFAULT 0, reason TEXT, employee_id TEXT, shift_id TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS stock_movements_product_idx ON stock_movements(product_id, created_at);

CREATE TABLE IF NOT EXISTS sale_cancellations (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, employee_id TEXT, employee_code TEXT, role TEXT,
  shift_id TEXT, device_id TEXT, reason TEXT NOT NULL, items_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS employee_permissions (
  employee_id TEXT NOT NULL, permission TEXT NOT NULL, PRIMARY KEY(employee_id, permission)
);
INSERT OR IGNORE INTO employee_permissions(employee_id, permission) VALUES
('staff-owner','SALE_CANCEL'),('staff-owner','PRODUCT_MANAGE'),('staff-owner','STOCK_MANAGE'),('staff-owner','SETTINGS_MANAGE'),('staff-owner','EMPLOYEE_MANAGE');

CREATE TRIGGER IF NOT EXISTS sales_expand_items
AFTER INSERT ON sales
WHEN NEW.status = 'completed'
BEGIN
  INSERT INTO sale_items(id,sale_id,product_id,name,quantity,unit_price,line_total)
  SELECT lower(hex(randomblob(16))), NEW.id,
         json_extract(value,'$.productId'), json_extract(value,'$.name'),
         CAST(json_extract(value,'$.quantity') AS INTEGER),
         CAST(json_extract(value,'$.unitPrice') AS REAL),
         CAST(json_extract(value,'$.quantity') AS INTEGER) * CAST(json_extract(value,'$.unitPrice') AS REAL)
  FROM json_each(NEW.items_json);

  INSERT INTO stock_movements(id,product_id,sku,name,movement_type,quantity,before_quantity,after_quantity,unit_cost,reason,employee_id,shift_id,created_at)
  SELECT lower(hex(randomblob(16))), p.id, p.sku, p.name, 'sale',
         CAST(json_extract(value,'$.quantity') AS INTEGER), p.stock_quantity,
         p.stock_quantity - CAST(json_extract(value,'$.quantity') AS INTEGER), p.cost,
         'SALE_COMPLETED ' || NEW.receipt_no, NEW.employee_id, NEW.shift_id, NEW.created_at
  FROM json_each(NEW.items_json) JOIN products p ON p.id = json_extract(value,'$.productId');

  UPDATE products SET stock_quantity = stock_quantity - (
    SELECT COALESCE(SUM(CAST(json_extract(value,'$.quantity') AS INTEGER)),0)
    FROM json_each(NEW.items_json) WHERE json_extract(value,'$.productId') = products.id
  ), updated_at = CURRENT_TIMESTAMP
  WHERE id IN (SELECT json_extract(value,'$.productId') FROM json_each(NEW.items_json));

  INSERT INTO audit_events(id,timestamp,employee_id,employee_code,role,action,entity_type,entity_id,shift_id,device_id,reason,status,details_json)
  VALUES(lower(hex(randomblob(16))), NEW.created_at, NEW.employee_id, NEW.employee_code, NULL, 'SALE_COMPLETED', 'sale', NEW.id, NEW.shift_id, NEW.device_id, NULL, NEW.payment_method, NEW.items_json);
END;