use serde::Serialize;
use serde_json::Value;
use std::{ffi::{c_void, CString}, fs, path::Path, process::Command};
use tauri::{Manager, Runtime};
use tauri_plugin_sql::{Migration, MigrationKind};
use windows_sys::Win32::Graphics::Printing::{ClosePrinter, EndDocPrinter, EndPagePrinter, OpenPrinterA, StartDocPrinterA, StartPagePrinter, WritePrinter, DOC_INFO_1A, PRINTER_HANDLE};
#[cfg(windows)]
use std::os::windows::process::CommandExt;

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
    cmd.args(["-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-Command", script]);
    #[cfg(windows)]
    cmd.creation_flags(0x08000000);
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

fn last_windows_error(prefix: &str) -> String {
    let detail = std::io::Error::last_os_error().to_string();
    format!("{}: {}", prefix, detail)
}

fn cp874_bytes(text: &str) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(text.len() + 16);
    for ch in text.replace("\r\n", "\n").replace('\r', "\n").chars() {
        match ch {
            '\n' => bytes.push(b'\n'),
            '\t' => bytes.push(b' '),
            c if c.is_ascii() => bytes.push(c as u8),
            '\u{2013}' | '\u{2014}' | '\u{2212}' => bytes.push(b'-'),
            '\u{2022}' => bytes.push(b'*'),
            c if ('\u{0E01}'..='\u{0E5B}').contains(&c) => bytes.push((c as u32 - 0x0E00 + 0xA0) as u8),
            _ => bytes.push(b'?'),
        }
    }
    bytes
}

fn print_raw_bytes(printer_name: &str, job_name: &str, payload: &[u8]) -> Result<(), String> {
    if printer_name.trim().is_empty() {
        return Err("PRINTER_NOT_CONFIGURED".into());
    }
    let printer = CString::new(printer_name).map_err(|_| "PRINTER_NAME_INVALID".to_string())?;
    let doc_name = CString::new(job_name).map_err(|_| "PRINT_JOB_INVALID".to_string())?;
    let data_type = CString::new("RAW").map_err(|_| "PRINT_DATATYPE_INVALID".to_string())?;
    let mut handle = PRINTER_HANDLE { Value: std::ptr::null_mut() };
    unsafe {
        if OpenPrinterA(printer.as_ptr() as *const u8, &mut handle, std::ptr::null()) == 0 {
            return Err(last_windows_error("OPEN_PRINTER_FAILED"));
        }
        let doc = DOC_INFO_1A {
            pDocName: doc_name.as_ptr() as *mut u8,
            pOutputFile: std::ptr::null_mut(),
            pDatatype: data_type.as_ptr() as *mut u8,
        };
        if StartDocPrinterA(handle, 1, &doc) == 0 {
            ClosePrinter(handle);
            return Err(last_windows_error("START_PRINT_JOB_FAILED"));
        }
        if StartPagePrinter(handle) == 0 {
            EndDocPrinter(handle);
            ClosePrinter(handle);
            return Err(last_windows_error("START_PRINT_PAGE_FAILED"));
        }
        let mut written = 0u32;
        let ok = WritePrinter(handle, payload.as_ptr() as *const c_void, payload.len() as u32, &mut written);
        EndPagePrinter(handle);
        EndDocPrinter(handle);
        ClosePrinter(handle);
        if ok == 0 || written != payload.len() as u32 {
            return Err(last_windows_error("WRITE_PRINTER_FAILED"));
        }
    }
    Ok(())
}

fn print_windows_text(printer_name: String, text: String) -> Result<(), String> {
    let mut bytes = vec![0x1B, 0x40, 0x1B, 0x21, 0x00];
    bytes.extend(cp874_bytes(&text));
    bytes.extend([b'\n', b'\n', b'\n', 0x1D, 0x56, 0x42, 0x00]);
    print_raw_bytes(&printer_name, "CpIPOS Receipt", &bytes)
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
fn print_receipt_raster(printer_name: String, bytes: Vec<u8>) -> Result<(), String> {
    let mut payload = vec![0x1B, 0x40];
    payload.extend(bytes);
    payload.extend([0x1B, 0x64, 0x08, 0x1D, 0x56, 0x42, 0x00]);
    print_raw_bytes(&printer_name, "CpIPOS Receipt Raster", &payload)
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
    let bytes = [0x1B, 0x70, 0x00, 0x19, 0xFA];
    print_raw_bytes(&printer_name, "CpIPOS Cash Drawer", &bytes).or_else(|_| {
        run_powershell(script, &[("CPIPOS_PRINTER_NAME", printer_name)])?;
        Ok(())
    })
}

const MAX_PRODUCT_IMAGE_BYTES: usize = 5 * 1024 * 1024;
const ALLOWED_PRODUCT_IMAGE_EXTENSIONS: [&str; 5] = ["png", "jpg", "jpeg", "webp", "gif"];

fn safe_product_image_name(file_name: &str) -> Result<String, String> {
    let file_name = Path::new(file_name).file_name().and_then(|name| name.to_str()).unwrap_or("product.png");
    let clean = file_name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
        .collect::<String>();
    let clean = if clean.is_empty() { "product.png".to_string() } else { clean };
    let path = Path::new(&clean);
    let ext = path.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
    if !ALLOWED_PRODUCT_IMAGE_EXTENSIONS.contains(&ext.as_str()) {
        return Err("PRODUCT_IMAGE_TYPE_UNSUPPORTED".into());
    }
    let stem = path.file_stem().and_then(|value| value.to_str()).unwrap_or("product");
    let stem = stem.trim_matches('.');
    let stem = if stem.is_empty() { "product" } else { stem };
    Ok(format!("{}.{}", stem, ext))
}

#[tauri::command]
fn save_product_image<R: Runtime>(
    app: tauri::AppHandle<R>,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    if bytes.is_empty() {
        return Err("PRODUCT_IMAGE_EMPTY".into());
    }
    if bytes.len() > MAX_PRODUCT_IMAGE_BYTES {
        return Err("PRODUCT_IMAGE_TOO_LARGE".into());
    }
    let safe_name = safe_product_image_name(&file_name)?;
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
        Migration { version: 8, description: "staff_pin_hashing", sql: include_str!("../migrations/0008_staff_pin_hashing.sql"), kind: MigrationKind::Up },
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
            print_receipt_raster,
            open_cash_drawer
        ])
        .run(tauri::generate_context!())
        .expect("error while running CpIPOS Desktop");
}
