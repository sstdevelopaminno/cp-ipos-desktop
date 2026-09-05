# CpIPOS Desktop Architecture

```text
React CpIPOS UI
      |
  PosRepository
      |
TauriRepository -------- BrowserRepository (UI-only development)
      |
SQLite cpipos.db
      |
Sales / Shift / Receipt / Sync Queue
```

## Offline invariant
Creating a sale, taking payment, opening/closing shift and reading the local catalog must not require Internet, Vercel or Supabase.

## Prototype limits
V0.1 PromptPay and Card are PAYMENT METHOD RECORDING ONLY: no payment gateway verifies that money was received. The temporary development PIN is demo-only and is not secure authentication.

This prototype is not production-ready. Phase 1 requires secure PIN hashing, receipt screen, receipt reprint, sales history, backup/restore and offline Tauri verification. Browser fallback uses localStorage; it cannot prove native launch or SQLite persistence.

## Next boundaries
1. `PrinterService` — 58/80mm ESC/POS + Windows spooler.
2. `BackupService` — consistent SQLite backup to AppData backup folder.
3. Secure local staff PIN hashing.
4. Receipt/history screens.
5. Optional cloud sync worker only after local transaction commit.

## Checkout atomicity
`tauri-plugin-sql` does not expose a first-class JavaScript transaction API. Desktop V0.1 therefore commits a sale using one `INSERT` into `sales`; a SQLite trigger expands `items_json` into `sale_items` in the same SQLite statement transaction. Do not replace this with separate JavaScript `BEGIN` / multiple `execute()` / `COMMIT` calls.
