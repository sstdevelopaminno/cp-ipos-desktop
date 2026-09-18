use rusqlite::Connection;
use std::fs;
use tauri::{Manager, Runtime};

fn column_exists(conn: &Connection, table: &str, column: &str) -> Result<bool, String> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({})", table)).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(1)).map_err(|e| e.to_string())?;
    for row in rows {
        if row.map_err(|e| e.to_string())?.eq_ignore_ascii_case(column) {
            return Ok(true);
        }
    }
    Ok(false)
}

fn table_sql(conn: &Connection, table: &str) -> Result<String, String> {
    conn.query_row(
        "SELECT COALESCE(sql,'') FROM sqlite_master WHERE type='table' AND name=?1",
        [table],
        |row| row.get::<_, String>(0),
    )
    .or_else(|_| Ok(String::new()))
    .map_err(|e: rusqlite::Error| e.to_string())
}

fn add_column(conn: &Connection, table: &str, column: &str, definition: &str) -> Result<(), String> {
    if !column_exists(conn, table, column)? {
        conn.execute_batch(&format!("ALTER TABLE {} ADD COLUMN {};", table, definition))
            .map_err(|e| format!("add column {}.{} failed: {}", table, column, e))?;
    }
    Ok(())
}

fn create_base_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(r#"
PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS staff (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner','manager','staff')),
  pin_demo TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  pin_hash TEXT,
  pin_salt TEXT,
  pin_hash_algorithm TEXT,
  pin_hash_iterations INTEGER,
  pin_updated_at TEXT
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category_id TEXT NOT NULL,
  category_name TEXT NOT NULL,
  price REAL NOT NULL CHECK(price >= 0),
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  barcode TEXT,
  cost REAL NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'ชิ้น',
  stock_quantity REAL NOT NULL DEFAULT 100,
  minimum_stock REAL NOT NULL DEFAULT 5,
  image_path TEXT,
  product_code TEXT,
  name_th TEXT,
  name_en TEXT,
  quantity_scale REAL NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS shifts (
  id TEXT PRIMARY KEY,
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  opening_cash REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK(status IN ('open','closed'))
);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_shift ON shifts(status) WHERE status='open';

CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,
  receipt_no TEXT NOT NULL UNIQUE,
  total REAL NOT NULL,
  paid REAL NOT NULL,
  change_amount REAL NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL CHECK(payment_method IN ('cash','transfer','promptpay','card')),
  items_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('completed','cancelled')),
  employee_id TEXT,
  employee_code TEXT,
  cashier_name TEXT,
  shift_id TEXT,
  device_id TEXT,
  cancelled_at TEXT,
  cancelled_by TEXT,
  cancelled_reason TEXT,
  void_restock INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sale_items (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id TEXT,
  name TEXT NOT NULL,
  quantity REAL NOT NULL CHECK(quantity > 0),
  unit_price REAL NOT NULL,
  line_total REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_queue (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  employee_id TEXT,
  employee_code TEXT,
  role TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  shift_id TEXT,
  device_id TEXT,
  reason TEXT,
  status TEXT,
  details_json TEXT
);
CREATE INDEX IF NOT EXISTS audit_events_timestamp_idx ON audit_events(timestamp);

CREATE TABLE IF NOT EXISTS stock_movements (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  movement_type TEXT NOT NULL CHECK(movement_type IN ('in','out','adjustment','sale')),
  quantity REAL NOT NULL,
  before_quantity REAL NOT NULL,
  after_quantity REAL NOT NULL,
  unit_cost REAL NOT NULL DEFAULT 0,
  reason TEXT,
  employee_id TEXT,
  shift_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS stock_movements_product_idx ON stock_movements(product_id, created_at);

CREATE TABLE IF NOT EXISTS sale_cancellations (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  employee_id TEXT,
  employee_code TEXT,
  role TEXT,
  shift_id TEXT,
  device_id TEXT,
  reason TEXT NOT NULL,
  items_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS employee_permissions (
  employee_id TEXT NOT NULL,
  permission TEXT NOT NULL,
  PRIMARY KEY(employee_id, permission)
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL UNIQUE REFERENCES sales(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK(method IN ('cash','transfer','promptpay','card')),
  amount REAL NOT NULL,
  received REAL NOT NULL,
  change_amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'recorded',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS receipts (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL UNIQUE REFERENCES sales(id) ON DELETE CASCADE,
  receipt_no TEXT NOT NULL,
  receipt_label TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'th',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_movement_ledger (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  movement_type TEXT NOT NULL CHECK(movement_type IN ('STOCK_IN','SALE','STOCK_OUT','ADJUSTMENT','SALE_VOID_RETURN')),
  quantity REAL NOT NULL,
  before_quantity REAL NOT NULL,
  after_quantity REAL NOT NULL,
  unit_cost REAL NOT NULL DEFAULT 0,
  reason TEXT,
  employee_id TEXT,
  shift_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS stock_movement_ledger_product_idx ON stock_movement_ledger(product_id, created_at);

CREATE TABLE IF NOT EXISTS sale_discounts (
  sale_id TEXT PRIMARY KEY REFERENCES sales(id) ON DELETE CASCADE,
  subtotal REAL NOT NULL CHECK(subtotal >= 0),
  discount_amount REAL NOT NULL CHECK(discount_amount >= 0),
  discount_type TEXT NOT NULL CHECK(discount_type IN ('amount','percent')),
  discount_value REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sale_discounts_created_at ON sale_discounts(created_at);

CREATE UNIQUE INDEX IF NOT EXISTS products_barcode_unique ON products(barcode) WHERE barcode IS NOT NULL AND barcode <> '';
CREATE INDEX IF NOT EXISTS products_barcode_idx ON products(barcode);
CREATE UNIQUE INDEX IF NOT EXISTS products_product_code_unique ON products(product_code) WHERE product_code IS NOT NULL AND product_code <> '';
CREATE INDEX IF NOT EXISTS staff_active_code_lookup ON staff(active, code);
"#)
    .map_err(|e| format!("create base schema failed: {}", e))?;
    Ok(())
}

fn ensure_columns(conn: &Connection) -> Result<(), String> {
    add_column(conn, "staff", "pin_hash", "pin_hash TEXT")?;
    add_column(conn, "staff", "pin_salt", "pin_salt TEXT")?;
    add_column(conn, "staff", "pin_hash_algorithm", "pin_hash_algorithm TEXT")?;
    add_column(conn, "staff", "pin_hash_iterations", "pin_hash_iterations INTEGER")?;
    add_column(conn, "staff", "pin_updated_at", "pin_updated_at TEXT")?;

    add_column(conn, "products", "barcode", "barcode TEXT")?;
    add_column(conn, "products", "cost", "cost REAL NOT NULL DEFAULT 0")?;
    add_column(conn, "products", "unit", "unit TEXT NOT NULL DEFAULT 'ชิ้น'")?;
    add_column(conn, "products", "stock_quantity", "stock_quantity REAL NOT NULL DEFAULT 100")?;
    add_column(conn, "products", "minimum_stock", "minimum_stock REAL NOT NULL DEFAULT 5")?;
    add_column(conn, "products", "image_path", "image_path TEXT")?;
    add_column(conn, "products", "product_code", "product_code TEXT")?;
    add_column(conn, "products", "name_th", "name_th TEXT")?;
    add_column(conn, "products", "name_en", "name_en TEXT")?;
    add_column(conn, "products", "quantity_scale", "quantity_scale REAL NOT NULL DEFAULT 1")?;

    add_column(conn, "sales", "status", "status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('completed','cancelled'))")?;
    add_column(conn, "sales", "employee_id", "employee_id TEXT")?;
    add_column(conn, "sales", "employee_code", "employee_code TEXT")?;
    add_column(conn, "sales", "cashier_name", "cashier_name TEXT")?;
    add_column(conn, "sales", "shift_id", "shift_id TEXT")?;
    add_column(conn, "sales", "device_id", "device_id TEXT")?;
    add_column(conn, "sales", "cancelled_at", "cancelled_at TEXT")?;
    add_column(conn, "sales", "cancelled_by", "cancelled_by TEXT")?;
    add_column(conn, "sales", "cancelled_reason", "cancelled_reason TEXT")?;
    add_column(conn, "sales", "void_restock", "void_restock INTEGER NOT NULL DEFAULT 0")?;
    Ok(())
}

fn rebuild_sales_if_needed(conn: &Connection) -> Result<(), String> {
    let sql = table_sql(conn, "sales")?;
    let has_status = column_exists(conn, "sales", "status")?;
    let allows_transfer = sql.contains("'transfer'");
    if allows_transfer && has_status {
        return Ok(());
    }

    conn.execute_batch(r#"
DROP TRIGGER IF EXISTS sales_expand_items;
DROP TRIGGER IF EXISTS sales_payment_receipt_ledger_v3;
DROP TRIGGER IF EXISTS sales_validate_stock_v4;
DROP TRIGGER IF EXISTS sales_checkout_v4;
DROP TRIGGER IF EXISTS sales_capture_discount_v5;
DROP TRIGGER IF EXISTS sales_void_ledger_v3;
ALTER TABLE sales RENAME TO sales_legacy_rebuild;
CREATE TABLE sales (
  id TEXT PRIMARY KEY,
  receipt_no TEXT NOT NULL UNIQUE,
  total REAL NOT NULL,
  paid REAL NOT NULL,
  change_amount REAL NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL CHECK(payment_method IN ('cash','transfer','promptpay','card')),
  items_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('completed','cancelled')),
  employee_id TEXT,
  employee_code TEXT,
  cashier_name TEXT,
  shift_id TEXT,
  device_id TEXT,
  cancelled_at TEXT,
  cancelled_by TEXT,
  cancelled_reason TEXT,
  void_restock INTEGER NOT NULL DEFAULT 0
);
"#)
        .map_err(|e| format!("prepare sales rebuild failed: {}", e))?;

    if has_status {
        conn.execute_batch(r#"
INSERT OR IGNORE INTO sales(id,receipt_no,total,paid,change_amount,payment_method,items_json,created_at,status,employee_id,employee_code,cashier_name,shift_id,device_id,cancelled_at,cancelled_by,cancelled_reason,void_restock)
SELECT id,receipt_no,total,paid,change_amount,payment_method,items_json,created_at,status,employee_id,employee_code,cashier_name,shift_id,device_id,cancelled_at,cancelled_by,cancelled_reason,COALESCE(void_restock,0) FROM sales_legacy_rebuild;
DROP TABLE sales_legacy_rebuild;
"#)
            .map_err(|e| format!("copy status sales failed: {}", e))?;
    } else {
        conn.execute_batch(r#"
INSERT OR IGNORE INTO sales(id,receipt_no,total,paid,change_amount,payment_method,items_json,created_at,status)
SELECT id,receipt_no,total,paid,change_amount,payment_method,items_json,created_at,'completed' FROM sales_legacy_rebuild;
DROP TABLE sales_legacy_rebuild;
"#)
            .map_err(|e| format!("copy legacy sales failed: {}", e))?;
    }

    Ok(())
}

fn seed_data(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(r#"
INSERT OR IGNORE INTO staff(id,code,display_name,role,pin_demo) VALUES('staff-owner','OWNR','ผู้ดูแลร้าน','owner','1234');
UPDATE staff SET code='OWNR' WHERE id='staff-owner' AND length(code) > 4 AND NOT EXISTS (SELECT 1 FROM staff WHERE lower(code)=lower('OWNR') AND id <> 'staff-owner');

INSERT OR IGNORE INTO products(id,sku,name,category_id,category_name,price,barcode,cost,unit,stock_quantity,minimum_stock,product_code,name_th,name_en,quantity_scale) VALUES
('p1','FOOD-001','กะเพราหมูสับ','food','อาหารตามสั่ง',60,'8850000000011',30,'จาน',80,10,'SF1705','กะเพราหมูสับ','',1),
('p2','FOOD-002','กะเพราไก่','food','อาหารตามสั่ง',60,'8850000000028',30,'จาน',80,10,'fko028','กะเพราไก่','',1),
('p3','FOOD-003','ข้าวผัดหมู','food','อาหารตามสั่ง',65,'8850000000035',32,'จาน',80,10,'FOOD-003','ข้าวผัดหมู','',1),
('p4','NOODLE-001','ก๋วยเตี๋ยวน้ำใส','noodle','ก๋วยเตี๋ยว',55,'8850000000042',25,'ชาม',80,10,'NOODLE-001','ก๋วยเตี๋ยวน้ำใส','',1),
('p5','NOODLE-002','ก๋วยเตี๋ยวต้มยำ','noodle','ก๋วยเตี๋ยว',60,'8850000000059',28,'ชาม',80,10,'NOODLE-002','ก๋วยเตี๋ยวต้มยำ','',1),
('p6','COFFEE-001','อเมริกาโน่','coffee','กาแฟ',55,'8850000000066',18,'แก้ว',100,15,'COFFEE-001','อเมริกาโน่','',1),
('p7','COFFEE-002','ลาเต้','coffee','กาแฟ',65,'8850000000073',22,'แก้ว',100,15,'COFFEE-002','ลาเต้','',1),
('p8','DRINK-001','ชาไทย','drink','เครื่องดื่ม',55,'8850000000080',18,'แก้ว',100,15,'DRINK-001','ชาไทย','',1),
('p9','DRINK-002','น้ำเปล่า','drink','เครื่องดื่ม',15,'8850000000097',7,'ขวด',120,24,'DRINK-002','น้ำเปล่า','',1);

UPDATE products SET product_code=COALESCE(NULLIF(product_code,''), sku), name_th=COALESCE(NULLIF(name_th,''), name), quantity_scale=COALESCE(quantity_scale,1);

INSERT OR IGNORE INTO app_settings(key,value) VALUES
('storeName','CpIPOS Store'),('branchName','Main Branch'),('deviceName','POS-01'),('deviceId','desktop-pos-01'),
('receiptHeader','CpIPOS'),('taxId',''),('address',''),('phone',''),('receiptFooter','ขอบคุณที่ใช้บริการ'),
('ownerName','Owner'),('ownerPinNote','Demo-only owner PIN. Secure hashing is a later task.'),('printerType','ยังไม่ได้ตั้งค่าเครื่องพิมพ์'),
('scannerMode','keyboard-wedge'),('remoteManagementEnabled','false'),('lastStorageReminderAt',''),('language','th'),
('printerSetupConfirmed','false'),('printerAutoConnect','true'),('printerAutoPrintReceipt','true'),('printerConnectionStatus','not_checked'),('printerLastCheckedAt',''),('cashDrawerEnabled','true');

INSERT OR IGNORE INTO employee_permissions(employee_id, permission) VALUES
('staff-owner','SALE_CANCEL'),('staff-owner','PRODUCT_MANAGE'),('staff-owner','STOCK_MANAGE'),('staff-owner','SETTINGS_MANAGE'),('staff-owner','EMPLOYEE_MANAGE');
"#)
        .map_err(|e| format!("seed data failed: {}", e))?;
    Ok(())
}

fn install_triggers(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(r#"
DROP TRIGGER IF EXISTS sales_expand_items;
DROP TRIGGER IF EXISTS sales_payment_receipt_ledger_v3;
DROP TRIGGER IF EXISTS sales_validate_stock_v4;
DROP TRIGGER IF EXISTS sales_checkout_v4;
DROP TRIGGER IF EXISTS sales_capture_discount_v5;
DROP TRIGGER IF EXISTS sales_void_ledger_v3;
DROP TRIGGER IF EXISTS staff_code_max_length_insert;
DROP TRIGGER IF EXISTS staff_code_max_length_update;

CREATE TRIGGER staff_code_max_length_insert
BEFORE INSERT ON staff
WHEN length(NEW.code) > 4
BEGIN
  SELECT RAISE(ABORT, 'EMPLOYEE_CODE_TOO_LONG');
END;

CREATE TRIGGER staff_code_max_length_update
BEFORE UPDATE OF code ON staff
WHEN length(NEW.code) > 4
BEGIN
  SELECT RAISE(ABORT, 'EMPLOYEE_CODE_TOO_LONG');
END;

CREATE TRIGGER sales_validate_stock_v4
BEFORE INSERT ON sales
WHEN NEW.status = 'completed'
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM (
      SELECT json_extract(value,'$.productId') AS product_id,
             SUM(CAST(json_extract(value,'$.quantity') AS REAL)) AS required_qty
      FROM json_each(NEW.items_json)
      GROUP BY json_extract(value,'$.productId')
    ) requested
    LEFT JOIN products p ON p.id = requested.product_id
    WHERE p.id IS NULL OR p.active <> 1 OR requested.required_qty <= 0
       OR ROUND(CAST(p.stock_quantity AS REAL), 3) < ROUND(requested.required_qty, 3)
  ) THEN RAISE(ABORT, 'INSUFFICIENT_STOCK') END;
END;

CREATE TRIGGER sales_checkout_v4
AFTER INSERT ON sales
WHEN NEW.status = 'completed'
BEGIN
  INSERT INTO sale_items(id,sale_id,product_id,name,quantity,unit_price,line_total)
  SELECT lower(hex(randomblob(16))), NEW.id, json_extract(value,'$.productId'), json_extract(value,'$.name'),
         ROUND(CAST(json_extract(value,'$.quantity') AS REAL), 3),
         ROUND(CAST(json_extract(value,'$.unitPrice') AS REAL), 2),
         ROUND(CAST(json_extract(value,'$.quantity') AS REAL) * CAST(json_extract(value,'$.unitPrice') AS REAL), 2)
  FROM json_each(NEW.items_json);

  INSERT OR IGNORE INTO payments(id,sale_id,method,amount,received,change_amount,status,created_at)
  VALUES(lower(hex(randomblob(16))), NEW.id, NEW.payment_method, ROUND(NEW.total,2), ROUND(NEW.paid,2), ROUND(NEW.change_amount,2), 'recorded', NEW.created_at);

  INSERT OR IGNORE INTO receipts(id,sale_id,receipt_no,receipt_label,language,created_at)
  VALUES(lower(hex(randomblob(16))), NEW.id, NEW.receipt_no, NEW.receipt_no, 'th', NEW.created_at);

  INSERT INTO stock_movement_ledger(id,product_id,sku,name,movement_type,quantity,before_quantity,after_quantity,unit_cost,reason,employee_id,shift_id,created_at)
  SELECT lower(hex(randomblob(16))), p.id, COALESCE(p.product_code,p.sku), COALESCE(p.name_th,p.name), 'SALE',
         requested.required_qty, ROUND(CAST(p.stock_quantity AS REAL),3), ROUND(CAST(p.stock_quantity AS REAL) - requested.required_qty,3),
         p.cost, 'SALE_COMPLETED ' || NEW.receipt_no, NEW.employee_id, NEW.shift_id, NEW.created_at
  FROM (
    SELECT json_extract(value,'$.productId') AS product_id, ROUND(SUM(CAST(json_extract(value,'$.quantity') AS REAL)),3) AS required_qty
    FROM json_each(NEW.items_json)
    GROUP BY json_extract(value,'$.productId')
  ) requested JOIN products p ON p.id = requested.product_id;

  UPDATE products
  SET stock_quantity = ROUND(CAST(stock_quantity AS REAL) - (
        SELECT COALESCE(SUM(CAST(json_extract(value,'$.quantity') AS REAL)),0)
        FROM json_each(NEW.items_json)
        WHERE json_extract(value,'$.productId') = products.id
      ), 3), updated_at = CURRENT_TIMESTAMP
  WHERE id IN (SELECT json_extract(value,'$.productId') FROM json_each(NEW.items_json));

  INSERT INTO audit_events(id,timestamp,employee_id,employee_code,role,action,entity_type,entity_id,shift_id,device_id,reason,status,details_json)
  VALUES(lower(hex(randomblob(16))), NEW.created_at, NEW.employee_id, NEW.employee_code, NULL, 'SALE_COMPLETED', 'sale', NEW.id, NEW.shift_id, NEW.device_id, NULL, NEW.payment_method, NEW.items_json);
END;

CREATE TRIGGER sales_capture_discount_v5
AFTER INSERT ON sales
WHEN NEW.status = 'completed'
BEGIN
  INSERT OR REPLACE INTO sale_discounts(sale_id, subtotal, discount_amount, discount_type, discount_value, created_at)
  SELECT NEW.id, ROUND(gross.subtotal, 2), ROUND(MAX(0, gross.subtotal - NEW.total), 2),
         CASE json_extract(NEW.items_json, '$[0].discountType') WHEN 'amount' THEN 'amount' WHEN 'percent' THEN 'percent' ELSE 'amount' END,
         ROUND(COALESCE(CAST(json_extract(NEW.items_json, '$[0].discountValue') AS REAL), 0), 2), NEW.created_at
  FROM (
    SELECT COALESCE(SUM(CAST(json_extract(value, '$.quantity') AS REAL) * CAST(COALESCE(json_extract(value, '$.originalUnitPrice'), json_extract(value, '$.unitPrice')) AS REAL)), 0) AS subtotal
    FROM json_each(NEW.items_json)
  ) gross
  WHERE ROUND(gross.subtotal - NEW.total, 2) > 0;
END;

CREATE TRIGGER sales_void_ledger_v3
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
"#)
        .map_err(|e| format!("install triggers failed: {}", e))?;
    Ok(())
}

pub fn ensure_database_schema<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;
    let db_path = app_dir.join("cpipos.db");
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA foreign_keys = OFF;").map_err(|e| e.to_string())?;
    create_base_schema(&conn)?;
    rebuild_sales_if_needed(&conn)?;
    ensure_columns(&conn)?;
    seed_data(&conn)?;
    install_triggers(&conn)?;
    conn.execute_batch("PRAGMA foreign_keys = ON;").map_err(|e| e.to_string())?;
    Ok(())
}
