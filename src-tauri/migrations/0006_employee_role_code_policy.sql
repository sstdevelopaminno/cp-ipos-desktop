UPDATE staff
SET code = 'OWNR'
WHERE id = 'staff-owner'
  AND length(code) > 4
  AND NOT EXISTS (SELECT 1 FROM staff WHERE lower(code) = lower('OWNR') AND id <> 'staff-owner');

CREATE TRIGGER IF NOT EXISTS staff_code_max_length_insert
BEFORE INSERT ON staff
WHEN length(NEW.code) > 4
BEGIN
  SELECT RAISE(ABORT, 'EMPLOYEE_CODE_TOO_LONG');
END;

CREATE TRIGGER IF NOT EXISTS staff_code_max_length_update
BEFORE UPDATE OF code ON staff
WHEN length(NEW.code) > 4
BEGIN
  SELECT RAISE(ABORT, 'EMPLOYEE_CODE_TOO_LONG');
END;
