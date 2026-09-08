use serde::Serialize;
use serde_json::Value;
use std::{fs, path::Path, process::Command};
use tauri::{Manager, Runtime};
use tauri_plugin_sql::{Migration, MigrationKind};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalStorageMetrics {
    database_size: u64,
    media_size: u64,
    backup_size: u64,
    app_data_size: u64,
    app_data_dir: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowsPrinter {
    name: String,
    status: String,
    is_default: bool,
    is_offline: bool,
}

fn dir_size(path: &Path) -> u64 {
    let mut total = 0;
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let p = entry.path();
            if let Ok(meta) = entry.metadata() {
                if meta.is_dir() {
                    total += dir_size(&p);
                } else {
                    total += meta.len();
                }
            }
        }
    }
    total
}

fn run_powershell(script: &str, envs: &[(&str, String)]) -> Result<String, String> {
    let mut cmd = Command::new("powershell");
    cmd.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script]);
    for (key, value) in envs {
        cmd.env(key, value);
    }
    let out = cmd.output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn value_str(value: &Value, key: &str) -> String {
    value.get(key).and_then(Value::as_str).unwrap_or_default().to_string()
}

fn value_bool(value: &Value, key: &str) -> bool {
    value.get(key).and_then(Value::as_bool).unwrap_or(false)
}

#[tauri::command]
fn list_windows_printers() -> Result<Vec<WindowsPrinter>, String> {
    let script = r#"
$default=(Get-CimInstance Win32_Printer | Where-Object {$_.Default -eq $true} | Select-Object -First 1 -ExpandProperty Name)
Get-Printer | Select-Object Name,PrinterStatus,WorkOffline,@{Name='IsDefault';Expression={$_.Name -eq $default}} | ConvertTo-Json -Compress
"#;
    let raw = run_powershell(script, &[])?;
    if raw.is_empty() {
        return Ok(vec![]);
    }
    let parsed: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let rows = match parsed {
        Value::Array(rows) => rows,
        value => vec![value],
    };
    Ok(rows
        .iter()
        .map(|row| WindowsPrinter {
            name: value_str(row, "Name"),
            status: value_str(row, "PrinterStatus"),
            is_default: value_bool(row, "IsDefault"),
            is_offline: value_bool(row, "WorkOffline"),
        })
        .filter(|p| !p.name.is_empty())
        .collect())
}

fn print_windows_text(printer_name: String, text: String) -> Result<(), String> {
    if printer_name.trim().is_empty() {
        return Err("PRINTER_NOT_CONFIGURED".into());
    }
    let script = r#"
$printer=$env:CPIPOS_PRINTER_NAME
$text=$env:CPIPOS_PRINT_TEXT
if([string]::IsNullOrWhiteSpace($printer)){ throw 'PRINTER_NOT_CONFIGURED' }
$text | Out-Printer -Name $printer
"#;
    run_powershell(script, &[("CPIPOS_PRINTER_NAME", printer_name), ("CPIPOS_PRINT_TEXT", text)])?;
    Ok(())
}

#[tauri::command]
fn print_test_receipt(printer_name: String) -> Result<(), String> {
    let text = format!(
        "CpIPOS Printer Test\nPrinter: {}\nTime: {}\nStatus: OK\n\n\n",
        printer_name,
        chrono_like_stamp()
    );
    print_windows_text(printer_name, text)
}

#[tauri::command]
fn print_receipt_text(printer_name: String, text: String) -> Result<(), String> {
    print_windows_text(printer_name, text)
}

#[tauri::command]
fn open_cash_drawer(printer_name: String) -> Result<(), String> {
    if printer_name.trim().is_empty() {
        return Err("PRINTER_NOT_CONFIGURED".into());
    }
    let script = r#"
$code=@"
using System;
using System.Runtime.InteropServices;
public class RawPrinterHelper {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)] public class DOCINFOA { [MarshalAs(UnmanagedType.LPStr)] public string pDocName; [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile; [MarshalAs(UnmanagedType.LPStr)] public string pDataType; }
  [DllImport("winspool.Drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)] public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)] public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)] public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
  [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)] public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)] public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)] public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)] public static extern bool WritePrinter(IntPtr hPrinter, byte[] bytes, Int32 count, out Int32 written);
  public static bool SendBytes(string printer, byte[] bytes) { IntPtr h; if(!OpenPrinter(printer,out h,IntPtr.Zero)) return false; DOCINFOA di=new DOCINFOA(); di.pDocName="CpIPOS Cash Drawer"; di.pDataType="RAW"; bool ok=StartDocPrinter(h,1,di); if(ok){ ok=StartPagePrinter(h); if(ok){ int written; ok=WritePrinter(h,bytes,bytes.Length,out written); } EndPagePrinter(h); EndDocPrinter(h); } ClosePrinter(h); return ok; }
}
"@
Add-Type -TypeDefinition $code
[byte[]]$bytes=27,112,0,25,250
if(-not [RawPrinterHelper]::SendBytes($env:CPIPOS_PRINTER_NAME,$bytes)){ throw 'CASH_DRAWER_FAILED' }
"#;
    run_powershell(script, &[("CPIPOS_PRINTER_NAME", printer_name)])?;
    Ok(())
}

#[tauri::command]
fn save_product_image<R: Runtime>(
    app: tauri::AppHandle<R>,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    let clean = file_name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
        .collect::<String>();
    let safe_name = if clean.is_empty() { "product.png".to_string() } else { clean };
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("media").join("products");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let relative = format!("media/products/{}-{}", chrono_like_stamp(), safe_name);
    let path = app.path().app_data_dir().map_err(|e| e.to_string())?.join(&relative);
    fs::write(path, bytes).map_err(|e| e.to_string())?;
    Ok(relative)
}

fn chrono_like_stamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis().to_string()
}

#[tauri::command]
fn get_local_storage_metrics<R: Runtime>(app: tauri::AppHandle<R>) -> Result<LocalStorageMetrics, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let database = app_dir.join("cpipos.db");
    let media = app_dir.join("media");
    let backup = app_dir.join("backups");
    let database_size = fs::metadata(database).map(|m| m.len()).unwrap_or(0);
    Ok(LocalStorageMetrics { database_size, media_size: dir_size(&media), backup_size: dir_size(&backup), app_data_size: dir_size(&app_dir), app_data_dir: app_dir.to_string_lossy().to_string() })
}

#[tauri::command]
fn complete_startup_splash<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    if let Some(main) = app.get_webview_window("main") {
        main.show().map_err(|e| e.to_string())?;
        main.set_focus().map_err(|e| e.to_string())?;
    }
    if let Some(splash) = app.get_webview_window("splash") {
        splash.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration { version: 1, description: "initial_offline_pos_schema", sql: include_str!("../migrations/0001_initial.sql"), kind: MigrationKind::Up },
        Migration { version: 2, description: "retail_core_foundation", sql: include_str!("../migrations/0002_retail_core_foundation.sql"), kind: MigrationKind::Up },
        Migration { version: 3, description: "retail_localization_voids", sql: include_str!("../migrations/0003_retail_localization_voids.sql"), kind: MigrationKind::Up },
        Migration { version: 4, description: "grocery_stock_precision", sql: include_str!("../migrations/0004_grocery_stock_precision.sql"), kind: MigrationKind::Up },
        Migration { version: 5, description: "sale_discount_metadata", sql: include_str!("../migrations/0005_sale_discounts.sql"), kind: MigrationKind::Up },
        Migration { version: 6, description: "employee_role_code_policy", sql: include_str!("../migrations/0006_employee_role_code_policy.sql"), kind: MigrationKind::Up },
        Migration { version: 7, description: "printer_automation_settings", sql: include_str!("../migrations/0007_printer_automation_settings.sql"), kind: MigrationKind::Up },
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().add_migrations("sqlite:cpipos.db", migrations).build())
        .invoke_handler(tauri::generate_handler![
            save_product_image,
            get_local_storage_metrics,
            complete_startup_splash,
            list_windows_printers,
            print_test_receipt,
            print_receipt_text,
            open_cash_drawer
        ])
        .run(tauri::generate_context!())
        .expect("error while running CpIPOS Desktop");
}
