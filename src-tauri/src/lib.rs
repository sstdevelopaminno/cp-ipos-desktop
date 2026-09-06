use serde::Serialize;
use std::{fs, path::Path};
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
    ];

    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:cpipos.db", migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![save_product_image, get_local_storage_metrics])
        .run(tauri::generate_context!())
        .expect("error while running CpIPOS Desktop");
}