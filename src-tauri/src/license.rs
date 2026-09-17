use base64::{engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD}, Engine as _};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs, path::PathBuf, time::{SystemTime, UNIX_EPOCH}};
use tauri::{Manager, Runtime};

#[cfg(windows)]
use winreg::{enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE}, RegKey};

const PRODUCT_ID: &str = "cpipos-desktop";
const TOKEN_PREFIX: &str = "CPIPOS1";
const TRIAL_DAYS: i64 = 30;
const SECONDS_PER_DAY: i64 = 86_400;
const CLOCK_ROLLBACK_TOLERANCE_SECONDS: i64 = 6 * 60 * 60;
const REGISTRY_PATH: &str = r"Software\CuttingPointTech\CpIPOS";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrialState {
    installed_at: i64,
    last_seen_at: i64,
    ever_activated: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LicensePayload {
    v: u8,
    product: String,
    license_id: String,
    customer: String,
    issued_at: i64,
    #[serde(default)]
    expires_at: Option<i64>,
    device_limit: u32,
    devices: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseStatus {
    mode: String,
    can_sell: bool,
    reason: String,
    device_fingerprint: String,
    trial_days_total: i64,
    trial_days_remaining: i64,
    trial_expires_at: i64,
    authority_configured: bool,
    license_id: Option<String>,
    customer: Option<String>,
    device_limit: Option<u32>,
    license_expires_at: Option<i64>,
}

fn unix_now() -> Result<i64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .map_err(|_| "SYSTEM_TIME_INVALID".to_string())
}

fn license_public_key_b64() -> &'static str {
    let env_key = option_env!("CPIPOS_LICENSE_PUBLIC_KEY_B64").unwrap_or("").trim();
    if !env_key.is_empty() {
        env_key
    } else {
        include_str!("../license_public_key.b64").trim()
    }
}

fn parse_public_key() -> Result<VerifyingKey, String> {
    let value = license_public_key_b64();
    if value.is_empty() || value == "UNCONFIGURED" {
        return Err("LICENSE_AUTHORITY_NOT_CONFIGURED".into());
    }
    let decoded = STANDARD
        .decode(value)
        .map_err(|_| "LICENSE_PUBLIC_KEY_INVALID".to_string())?;
    let bytes: [u8; 32] = decoded
        .try_into()
        .map_err(|_| "LICENSE_PUBLIC_KEY_INVALID".to_string())?;
    VerifyingKey::from_bytes(&bytes).map_err(|_| "LICENSE_PUBLIC_KEY_INVALID".to_string())
}

fn authority_configured() -> bool {
    parse_public_key().is_ok()
}

#[cfg(windows)]
fn machine_guid() -> Result<String, String> {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let key = hklm
        .open_subkey(r"SOFTWARE\Microsoft\Cryptography")
        .map_err(|_| "MACHINE_GUID_UNAVAILABLE".to_string())?;
    key.get_value::<String, _>("MachineGuid")
        .map_err(|_| "MACHINE_GUID_UNAVAILABLE".to_string())
}

#[cfg(not(windows))]
fn machine_guid() -> Result<String, String> {
    Ok(std::env::var("HOSTNAME").unwrap_or_else(|_| "CPIPOS-NON-WINDOWS".to_string()))
}

fn device_fingerprint_internal() -> Result<String, String> {
    let source = format!("cpipos-device-v1|{}", machine_guid()?.trim().to_ascii_lowercase());
    let digest = Sha256::digest(source.as_bytes());
    let compact = digest[..16]
        .iter()
        .map(|byte| format!("{:02X}", byte))
        .collect::<String>();
    Ok(format!(
        "CPD-{}-{}-{}-{}",
        &compact[0..8],
        &compact[8..16],
        &compact[16..24],
        &compact[24..32]
    ))
}

fn license_dir<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("license");
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

fn trial_state_path<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    Ok(license_dir(app)?.join("trial_state.json"))
}

fn license_code_path<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    Ok(license_dir(app)?.join("license.cpipos"))
}

fn read_file_trial_state<R: Runtime>(app: &tauri::AppHandle<R>) -> Option<TrialState> {
    let path = trial_state_path(app).ok()?;
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

fn write_file_trial_state<R: Runtime>(app: &tauri::AppHandle<R>, state: &TrialState) -> Result<(), String> {
    let path = trial_state_path(app)?;
    let raw = serde_json::to_string(state).map_err(|error| error.to_string())?;
    fs::write(path, raw).map_err(|error| error.to_string())
}

#[cfg(windows)]
fn read_registry_trial_state() -> Option<TrialState> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu.open_subkey(REGISTRY_PATH).ok()?;
    let installed_at = key.get_value::<String, _>("TrialInstalledAt").ok()?.parse().ok()?;
    let last_seen_at = key.get_value::<String, _>("TrialLastSeenAt").ok()?.parse().ok()?;
    let ever_activated = key
        .get_value::<String, _>("EverActivated")
        .unwrap_or_else(|_| "0".to_string())
        == "1";
    Some(TrialState { installed_at, last_seen_at, ever_activated })
}

#[cfg(not(windows))]
fn read_registry_trial_state() -> Option<TrialState> {
    None
}

#[cfg(windows)]
fn write_registry_trial_state(state: &TrialState) {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok((key, _)) = hkcu.create_subkey(REGISTRY_PATH) {
        let _ = key.set_value("TrialInstalledAt", &state.installed_at.to_string());
        let _ = key.set_value("TrialLastSeenAt", &state.last_seen_at.to_string());
        let _ = key.set_value("EverActivated", if state.ever_activated { "1" } else { "0" });
    }
}

#[cfg(not(windows))]
fn write_registry_trial_state(_state: &TrialState) {}

fn persist_trial_state<R: Runtime>(app: &tauri::AppHandle<R>, state: &TrialState) -> Result<(), String> {
    write_file_trial_state(app, state)?;
    write_registry_trial_state(state);
    Ok(())
}

fn reconcile_trial_state<R: Runtime>(
    app: &tauri::AppHandle<R>,
    now: i64,
) -> Result<(TrialState, bool), String> {
    let file_state = read_file_trial_state(app);
    let registry_state = read_registry_trial_state();

    let installed_at = match (&file_state, &registry_state) {
        (Some(file), Some(registry)) => file.installed_at.min(registry.installed_at),
        (Some(file), None) => file.installed_at,
        (None, Some(registry)) => registry.installed_at,
        (None, None) => now,
    };

    let previous_last_seen = match (&file_state, &registry_state) {
        (Some(file), Some(registry)) => file.last_seen_at.max(registry.last_seen_at),
        (Some(file), None) => file.last_seen_at,
        (None, Some(registry)) => registry.last_seen_at,
        (None, None) => now,
    };

    let ever_activated = file_state.as_ref().map(|state| state.ever_activated).unwrap_or(false)
        || registry_state.as_ref().map(|state| state.ever_activated).unwrap_or(false);

    let clock_rollback = now + CLOCK_ROLLBACK_TOLERANCE_SECONDS < previous_last_seen;
    let state = TrialState {
        installed_at,
        last_seen_at: if clock_rollback { previous_last_seen } else { previous_last_seen.max(now) },
        ever_activated,
    };
    persist_trial_state(app, &state)?;
    Ok((state, clock_rollback))
}

fn read_stored_license<R: Runtime>(app: &tauri::AppHandle<R>) -> Option<String> {
    let path = license_code_path(app).ok()?;
    fs::read_to_string(path).ok().map(|value| value.trim().to_string()).filter(|value| !value.is_empty())
}

fn store_license<R: Runtime>(app: &tauri::AppHandle<R>, code: &str) -> Result<(), String> {
    let path = license_code_path(app)?;
    fs::write(path, code.trim()).map_err(|error| error.to_string())
}

fn verify_license_code(code: &str, now: i64, device_fingerprint: &str) -> Result<LicensePayload, String> {
    let mut parts = code.trim().split('.');
    let prefix = parts.next().unwrap_or_default();
    let payload_b64 = parts.next().unwrap_or_default();
    let signature_b64 = parts.next().unwrap_or_default();
    if prefix != TOKEN_PREFIX || payload_b64.is_empty() || signature_b64.is_empty() || parts.next().is_some() {
        return Err("LICENSE_FORMAT_INVALID".into());
    }

    let public_key = parse_public_key()?;
    let payload_bytes = URL_SAFE_NO_PAD
        .decode(payload_b64)
        .map_err(|_| "LICENSE_PAYLOAD_INVALID".to_string())?;
    let signature_bytes = URL_SAFE_NO_PAD
        .decode(signature_b64)
        .map_err(|_| "LICENSE_SIGNATURE_INVALID".to_string())?;
    let signature_array: [u8; 64] = signature_bytes
        .try_into()
        .map_err(|_| "LICENSE_SIGNATURE_INVALID".to_string())?;
    let signature = Signature::from_bytes(&signature_array);
    let signed_message = format!("{}.{}", TOKEN_PREFIX, payload_b64);
    public_key
        .verify(signed_message.as_bytes(), &signature)
        .map_err(|_| "LICENSE_SIGNATURE_INVALID".to_string())?;

    let payload: LicensePayload = serde_json::from_slice(&payload_bytes)
        .map_err(|_| "LICENSE_PAYLOAD_INVALID".to_string())?;
    if payload.v != 1 || payload.product != PRODUCT_ID {
        return Err("LICENSE_PRODUCT_INVALID".into());
    }
    if payload.license_id.trim().is_empty() || payload.customer.trim().is_empty() {
        return Err("LICENSE_PAYLOAD_INVALID".into());
    }
    if payload.device_limit == 0
        || payload.devices.is_empty()
        || payload.devices.len() > payload.device_limit as usize
    {
        return Err("LICENSE_DEVICE_POLICY_INVALID".into());
    }
    if !payload
        .devices
        .iter()
        .any(|device| device.eq_ignore_ascii_case(device_fingerprint))
    {
        return Err("LICENSE_DEVICE_NOT_ALLOWED".into());
    }
    if payload.issued_at > now + SECONDS_PER_DAY {
        return Err("LICENSE_NOT_YET_VALID".into());
    }
    if let Some(expires_at) = payload.expires_at {
        if expires_at <= payload.issued_at || now > expires_at {
            return Err("LICENSE_EXPIRED".into());
        }
    }
    Ok(payload)
}

fn locked_status(
    reason: impl Into<String>,
    device_fingerprint: String,
    trial_state: &TrialState,
    authority: bool,
    license: Option<&LicensePayload>,
) -> LicenseStatus {
    LicenseStatus {
        mode: "locked".into(),
        can_sell: false,
        reason: reason.into(),
        device_fingerprint,
        trial_days_total: TRIAL_DAYS,
        trial_days_remaining: 0,
        trial_expires_at: trial_state.installed_at + TRIAL_DAYS * SECONDS_PER_DAY,
        authority_configured: authority,
        license_id: license.map(|item| item.license_id.clone()),
        customer: license.map(|item| item.customer.clone()),
        device_limit: license.map(|item| item.device_limit),
        license_expires_at: license.and_then(|item| item.expires_at),
    }
}

fn status_internal<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<LicenseStatus, String> {
    let now = unix_now()?;
    let device_fingerprint = device_fingerprint_internal()?;
    let authority = authority_configured();
    let (trial_state, clock_rollback) = reconcile_trial_state(app, now)?;
    let trial_expires_at = trial_state.installed_at + TRIAL_DAYS * SECONDS_PER_DAY;

    if let Some(code) = read_stored_license(app) {
        match verify_license_code(&code, now, &device_fingerprint) {
            Ok(payload) => {
                if clock_rollback && payload.expires_at.is_some() {
                    return Ok(locked_status(
                        "clock_rollback",
                        device_fingerprint,
                        &trial_state,
                        authority,
                        Some(&payload),
                    ));
                }
                return Ok(LicenseStatus {
                    mode: "active".into(),
                    can_sell: true,
                    reason: "license_valid".into(),
                    device_fingerprint,
                    trial_days_total: TRIAL_DAYS,
                    trial_days_remaining: 0,
                    trial_expires_at,
                    authority_configured: authority,
                    license_id: Some(payload.license_id),
                    customer: Some(payload.customer),
                    device_limit: Some(payload.device_limit),
                    license_expires_at: payload.expires_at,
                });
            }
            Err(reason) => {
                return Ok(locked_status(
                    reason.to_ascii_lowercase(),
                    device_fingerprint,
                    &trial_state,
                    authority,
                    None,
                ));
            }
        }
    }

    if trial_state.ever_activated {
        return Ok(locked_status(
            "license_missing_after_activation",
            device_fingerprint,
            &trial_state,
            authority,
            None,
        ));
    }

    if clock_rollback {
        return Ok(locked_status(
            "clock_rollback",
            device_fingerprint,
            &trial_state,
            authority,
            None,
        ));
    }

    if now < trial_expires_at {
        let remaining_seconds = trial_expires_at - now;
        let remaining_days = (remaining_seconds + SECONDS_PER_DAY - 1) / SECONDS_PER_DAY;
        return Ok(LicenseStatus {
            mode: "trial".into(),
            can_sell: true,
            reason: "trial_active".into(),
            device_fingerprint,
            trial_days_total: TRIAL_DAYS,
            trial_days_remaining: remaining_days.max(0),
            trial_expires_at,
            authority_configured: authority,
            license_id: None,
            customer: None,
            device_limit: None,
            license_expires_at: None,
        });
    }

    Ok(locked_status(
        "trial_expired",
        device_fingerprint,
        &trial_state,
        authority,
        None,
    ))
}

#[tauri::command]
pub fn get_device_fingerprint() -> Result<String, String> {
    device_fingerprint_internal()
}

#[tauri::command]
pub fn get_license_status<R: Runtime>(app: tauri::AppHandle<R>) -> Result<LicenseStatus, String> {
    status_internal(&app)
}

#[tauri::command]
pub fn activate_offline_license<R: Runtime>(
    app: tauri::AppHandle<R>,
    license_code: String,
) -> Result<LicenseStatus, String> {
    let now = unix_now()?;
    let device_fingerprint = device_fingerprint_internal()?;
    let payload = verify_license_code(&license_code, now, &device_fingerprint)?;
    store_license(&app, &license_code)?;

    let (mut state, _) = reconcile_trial_state(&app, now)?;
    state.ever_activated = true;
    state.last_seen_at = state.last_seen_at.max(now);
    persist_trial_state(&app, &state)?;

    let status = LicenseStatus {
        mode: "active".into(),
        can_sell: true,
        reason: "license_valid".into(),
        device_fingerprint,
        trial_days_total: TRIAL_DAYS,
        trial_days_remaining: 0,
        trial_expires_at: state.installed_at + TRIAL_DAYS * SECONDS_PER_DAY,
        authority_configured: authority_configured(),
        license_id: Some(payload.license_id),
        customer: Some(payload.customer),
        device_limit: Some(payload.device_limit),
        license_expires_at: payload.expires_at,
    };
    Ok(status)
}
