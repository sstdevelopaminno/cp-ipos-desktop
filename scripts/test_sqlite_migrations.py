from __future__ import annotations

import json
import sqlite3
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = [
    ROOT / "src-tauri/migrations/0001_initial.sql",
    ROOT / "src-tauri/migrations/0002_retail_core_foundation.sql",
    ROOT / "src-tauri/migrations/0003_retail_localization_voids.sql",
    ROOT / "src-tauri/migrations/0004_grocery_stock_precision.sql",
]


def close(a: float, b: float, eps: float = 1e-9) -> bool:
    return abs(float(a) - float(b)) <= eps


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        db_path = Path(tmp) / "cpipos-test.db"
        con = sqlite3.connect(db_path)
        con.execute("PRAGMA foreign_keys=ON")
        for migration in MIGRATIONS:
            con.executescript(migration.read_text(encoding="utf-8-sig"))

        before = float(con.execute("SELECT stock_quantity FROM products WHERE id='p9'").fetchone()[0])
        qty = 1.25
        unit_price = 15.0
        sale_id = "test-decimal-sale"
        items = json.dumps([
            {
                "productId": "p9",
                "name": "น้ำเปล่า",
                "quantity": qty,
                "unitPrice": unit_price,
            }
        ], ensure_ascii=False)

        con.execute(
            """
            INSERT INTO sales(
              id,receipt_no,total,paid,change_amount,payment_method,items_json,created_at,status,
              employee_id,employee_code,cashier_name,shift_id,device_id
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                sale_id,
                "R-DECIMAL-001",
                qty * unit_price,
                20.0,
                20.0 - qty * unit_price,
                "cash",
                items,
                "2026-09-06T12:00:00.000",
                "completed",
                "staff-owner",
                "OWNER",
                "ผู้ดูแลร้าน",
                "test-shift",
                "test-device",
            ),
        )
        con.commit()

        after = float(con.execute("SELECT stock_quantity FROM products WHERE id='p9'").fetchone()[0])
        assert close(after, before - qty), (before, after)

        item_qty, line_total = con.execute(
            "SELECT quantity,line_total FROM sale_items WHERE sale_id=?", (sale_id,)
        ).fetchone()
        assert close(item_qty, qty), item_qty
        assert close(line_total, qty * unit_price), line_total

        ledger = con.execute(
            "SELECT quantity,before_quantity,after_quantity FROM stock_movement_ledger WHERE reason='SALE_COMPLETED R-DECIMAL-001'"
        ).fetchone()
        assert ledger is not None
        assert close(ledger[0], qty), ledger
        assert close(ledger[1], before), ledger
        assert close(ledger[2], before - qty), ledger

        assert con.execute("SELECT COUNT(*) FROM payments WHERE sale_id=?", (sale_id,)).fetchone()[0] == 1
        assert con.execute("SELECT COUNT(*) FROM receipts WHERE sale_id=?", (sale_id,)).fetchone()[0] == 1
        assert con.execute("SELECT COUNT(*) FROM audit_events WHERE action='SALE_COMPLETED' AND entity_id=?", (sale_id,)).fetchone()[0] == 1

        con.execute(
            "UPDATE sales SET status='cancelled',cancelled_at=?,cancelled_by=?,cancelled_reason=?,void_restock=1 WHERE id=?",
            ("2026-09-06T12:05:00.000", "staff-owner", "test void", sale_id),
        )
        con.commit()
        restored = float(con.execute("SELECT stock_quantity FROM products WHERE id='p9'").fetchone()[0])
        assert close(restored, before), (before, restored)
        assert con.execute(
            "SELECT COUNT(*) FROM stock_movement_ledger WHERE movement_type='SALE_VOID_RETURN' AND reason='test void'"
        ).fetchone()[0] == 1

        too_much = json.dumps([
            {"productId": "p9", "name": "น้ำเปล่า", "quantity": 999999, "unitPrice": 15}
        ], ensure_ascii=False)
        rejected = False
        try:
            con.execute(
                """
                INSERT INTO sales(
                  id,receipt_no,total,paid,change_amount,payment_method,items_json,created_at,status,
                  employee_id,employee_code,cashier_name,shift_id,device_id
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    "test-insufficient",
                    "R-INSUFFICIENT",
                    14999985,
                    14999985,
                    0,
                    "cash",
                    too_much,
                    "2026-09-06T12:10:00.000",
                    "completed",
                    "staff-owner",
                    "OWNER",
                    "ผู้ดูแลร้าน",
                    "test-shift",
                    "test-device",
                ),
            )
            con.commit()
        except sqlite3.IntegrityError as exc:
            con.rollback()
            rejected = "INSUFFICIENT_STOCK" in str(exc)
        assert rejected, "checkout exceeding stock must be rejected by SQLite"

        print("PASS: migrations apply, decimal stock deducts exactly once, void restores, insufficient stock is rejected")


if __name__ == "__main__":
    main()
