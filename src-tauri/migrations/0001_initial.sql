CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS staff (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner','manager','staff')),
  pin_demo TEXT, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY, sku TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  category_id TEXT NOT NULL, category_name TEXT NOT NULL,
  price REAL NOT NULL CHECK(price >= 0), active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS shifts (
  id TEXT PRIMARY KEY, opened_at TEXT NOT NULL, closed_at TEXT,
  opening_cash REAL NOT NULL DEFAULT 0, status TEXT NOT NULL CHECK(status IN ('open','closed'))
);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_shift ON shifts(status) WHERE status='open';
CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY, receipt_no TEXT NOT NULL UNIQUE, total REAL NOT NULL,
  paid REAL NOT NULL, change_amount REAL NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL CHECK(payment_method IN ('cash','promptpay','card')),
  items_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sale_items (
  id TEXT PRIMARY KEY, sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id TEXT, name TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity > 0),
  unit_price REAL NOT NULL, line_total REAL NOT NULL
);
CREATE TRIGGER IF NOT EXISTS sales_expand_items
AFTER INSERT ON sales
BEGIN
  INSERT INTO sale_items(id,sale_id,product_id,name,quantity,unit_price,line_total)
  SELECT lower(hex(randomblob(16))), NEW.id,
         json_extract(value,'$.productId'), json_extract(value,'$.name'),
         CAST(json_extract(value,'$.quantity') AS INTEGER),
         CAST(json_extract(value,'$.unitPrice') AS REAL),
         CAST(json_extract(value,'$.quantity') AS INTEGER) * CAST(json_extract(value,'$.unitPrice') AS REAL)
  FROM json_each(NEW.items_json);
END;
CREATE TABLE IF NOT EXISTS sync_queue (
  id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  operation TEXT NOT NULL, payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO staff(id,code,display_name,role,pin_demo) VALUES('staff-owner','OWNER','ผู้ดูแลร้าน','owner','1234');
INSERT OR IGNORE INTO products(id,sku,name,category_id,category_name,price) VALUES
('p1','FOOD-001','กะเพราหมูสับ','food','อาหารตามสั่ง',60),
('p2','FOOD-002','กะเพราไก่','food','อาหารตามสั่ง',60),
('p3','FOOD-003','ข้าวผัดหมู','food','อาหารตามสั่ง',65),
('p4','NOODLE-001','ก๋วยเตี๋ยวน้ำใส','noodle','ก๋วยเตี๋ยว',55),
('p5','NOODLE-002','ก๋วยเตี๋ยวต้มยำ','noodle','ก๋วยเตี๋ยว',60),
('p6','COFFEE-001','อเมริกาโน่','coffee','กาแฟ',55),
('p7','COFFEE-002','ลาเต้','coffee','กาแฟ',65),
('p8','DRINK-001','ชาไทย','drink','เครื่องดื่ม',55),
('p9','DRINK-002','น้ำเปล่า','drink','เครื่องดื่ม',15);
