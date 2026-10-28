use serde::Serialize;
use serde_json::Value;
use std::{process::Command, sync::{Mutex, OnceLock}, time::{Duration, Instant}};
#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowsSystemHealth {
    pub device_name: String,
    pub machine_id: String,
    pub cpu_percent: f64,
    pub memory_percent: f64,
    pub disk_free_bytes: u64,
    pub logical_processors: u64,
}

fn number(value: &Value, key: &str) -> f64 {
    value.get(key).and_then(Value::as_f64).unwrap_or(0.0)
}

fn text(value: &Value, key: &str) -> String {
    value.get(key).and_then(Value::as_str).unwrap_or_default().trim().to_string()
}

#[tauri::command]
pub fn get_windows_system_health() -> Result<WindowsSystemHealth, String> {
    #[cfg(not(windows))]
    {
        return Ok(WindowsSystemHealth {
            device_name: std::env::var("HOSTNAME").unwrap_or_default(),
            machine_id: String::new(),
            cpu_percent: 0.0,
            memory_percent: 0.0,
            disk_free_bytes: 0,
            logical_processors: std::thread::available_parallelism().map(|v| v.get() as u64).unwrap_or(0),
        });
    }

    #[cfg(windows)]
    {
        static HEALTH_CACHE: OnceLock<Mutex<Option<(Instant, WindowsSystemHealth)>>> = OnceLock::new();
        let cache = HEALTH_CACHE.get_or_init(|| Mutex::new(None));
        if let Ok(guard) = cache.lock() {
            if let Some((sampled_at, health)) = &*guard {
                if sampled_at.elapsed() < Duration::from_secs(10 * 60) {
                    return Ok(health.clone());
                }
            }
        }

        let script = r#"
$cpu=(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
$os=Get-CimInstance Win32_OperatingSystem
$total=[double]$os.TotalVisibleMemorySize
$free=[double]$os.FreePhysicalMemory
$mem=if($total -gt 0){(($total-$free)/$total)*100}else{0}
$disk=Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'" | Select-Object -First 1
$uuid=(Get-CimInstance Win32_ComputerSystemProduct | Select-Object -First 1 -ExpandProperty UUID)
$processors=(Get-CimInstance Win32_ComputerSystem | Select-Object -First 1 -ExpandProperty NumberOfLogicalProcessors)
[pscustomobject]@{
  DeviceName=$env:COMPUTERNAME
  MachineId=[string]$uuid
  CpuPercent=[double]$cpu
  MemoryPercent=[double]$mem
  DiskFreeBytes=[double]$disk.FreeSpace
  LogicalProcessors=[double]$processors
} | ConvertTo-Json -Compress
"#;
        let mut cmd = Command::new("powershell");
        cmd.args(["-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-Command", script]);
        cmd.creation_flags(0x08000000);
        let output = cmd.output().map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
        let raw = String::from_utf8_lossy(&output.stdout);
        let value: Value = serde_json::from_str(raw.trim()).map_err(|e| e.to_string())?;
        let health = WindowsSystemHealth {
            device_name: text(&value, "DeviceName"),
            machine_id: text(&value, "MachineId"),
            cpu_percent: number(&value, "CpuPercent").clamp(0.0, 100.0),
            memory_percent: number(&value, "MemoryPercent").clamp(0.0, 100.0),
            disk_free_bytes: number(&value, "DiskFreeBytes").max(0.0) as u64,
            logical_processors: number(&value, "LogicalProcessors").max(0.0) as u64,
        };
        if let Ok(mut guard) = cache.lock() {
            *guard = Some((Instant::now(), health.clone()));
        }
        Ok(health)
    }
}