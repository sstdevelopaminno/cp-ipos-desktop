use serde::Serialize;
use std::{
    collections::hash_map::DefaultHasher,
    fs,
    hash::{Hash, Hasher},
    path::Path,
};
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

#[tauri::command]
fn save_product_image<R: Runtime>(app: tauri::AppHandle<R>, file_name: String, bytes: Vec<u8>) -> Result<String, String> {
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
    Ok(LocalStorageMetrics {
        database_size,
        media_size: dir_size(&media),
        backup_size: dir_size(&backup),
        app_data_size: dir_size(&app_dir),
        app_data_dir: app_dir.to_string_lossy().to_string(),
    })
}

#[cfg(target_os = "windows")]
fn platform_machine_seed() -> Option<String> {
    use std::process::Command;

    let output = Command::new("reg")
        .args([
            "query",
            r"HKLM\SOFTWARE\Microsoft\Cryptography",
            "/v",
            "MachineGuid",
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .lines()
        .find(|line| line.to_ascii_lowercase().contains("machineguid"))
        .and_then(|line| line.split_whitespace().last())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

#[cfg(not(target_os = "windows"))]
fn platform_machine_seed() -> Option<String> {
    std::env::var("HOSTNAME").ok().filter(|value| !value.trim().is_empty())
}

fn hashed_device_seed(seed: &str) -> String {
    let mut first = DefaultHasher::new();
    "CPIPOS-DESKTOP-LICENSE-A".hash(&mut first);
    seed.hash(&mut first);
    let mut second = DefaultHasher::new();
    "CPIPOS-DESKTOP-LICENSE-B".hash(&mut second);
    seed.hash(&mut second);
    format!("{:016X}{:016X}", first.finish(), second.finish())
}

#[tauri::command]
fn get_license_device_code() -> String {
    let seed = platform_machine_seed()
        .or_else(|| std::env::var("COMPUTERNAME").ok())
        .or_else(|| std::env::var("HOSTNAME").ok())
        .unwrap_or_else(|| "CPIPOS-UNKNOWN-MACHINE".to_string());
    let cleaned = seed
        .chars()
        .filter(|char| char.is_ascii_hexdigit())
        .map(|char| char.to_ascii_uppercase())
        .collect::<String>();
    let source = if cleaned.len() >= 20 { cleaned } else { hashed_device_seed(&seed) };
    let code = &source[..20];
    format!("CP-{}-{}-{}-{}", &code[0..5], &code[5..10], &code[10..15], &code[15..20])
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
        Migration {
            version: 1,
            description: "initial_offline_pos_schema",
            sql: include_str!("../migrations/0001_initial.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "retail_core_foundation",
            sql: include_str!("../migrations/0002_retail_core_foundation.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "retail_localization_voids",
            sql: include_str!("../migrations/0003_retail_localization_voids.sql"),
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:cpipos.db", migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            save_product_image,
            get_local_storage_metrics,
            get_license_device_code,
            complete_startup_splash
        ])
        .run(tauri::generate_context!())
        .expect("error while running CpIPOS Desktop");
}
