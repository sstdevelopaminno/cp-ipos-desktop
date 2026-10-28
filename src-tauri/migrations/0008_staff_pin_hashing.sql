ALTER TABLE staff ADD COLUMN pin_hash TEXT;
ALTER TABLE staff ADD COLUMN pin_salt TEXT;
ALTER TABLE staff ADD COLUMN pin_hash_algorithm TEXT;
ALTER TABLE staff ADD COLUMN pin_hash_iterations INTEGER;
ALTER TABLE staff ADD COLUMN pin_updated_at TEXT;

CREATE INDEX IF NOT EXISTS staff_active_code_lookup ON staff(active, code);