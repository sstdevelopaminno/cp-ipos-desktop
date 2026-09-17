import { invoke } from "@tauri-apps/api/core";

type LicenseMode = "trial" | "active" | "locked";
type LicenseStatus = {
  mode: LicenseMode;
  canSell: boolean;
  reason: string;
  deviceFingerprint: string;
  trialDaysTotal: number;
  trialDaysRemaining: number;
  trialExpiresAt: number;
  authorityConfigured: boolean;
  licenseId: string | null;
  customer: string | null;
  deviceLimit: number | null;
  licenseExpiresAt: number | null;
};

declare global {
  interface Window {
    __CPIPOS_LICENSE_STATUS__?: LicenseStatus;
    __CPIPOS_LICENSE__?: {
      refresh: () => Promise<LicenseStatus>;
      activate: (licenseCode: string) => Promise<LicenseStatus>;
      getStatus: () => LicenseStatus | undefined;
    };
  }
}

const LEGACY_FREE_MODE_KEY = "cpipos.license.freeForever.enabled";
const LEGACY_CONFIG_KEY = "cpipos.commercial.settings.v1";
const LOCK_GATE_ID = "cpipos-license-gate";
const TRIAL_BADGE_ID = "cpipos-license-trial-badge";
const SALE_ACTION = /ชำระเงิน|ยืนยันรับเงิน|ยืนยันรับชำระ|บันทึกบิล|ปิดบิล|รับชำระ|checkout|payment|complete sale/i;

let currentStatus: LicenseStatus | undefined;
let refreshInFlight: Promise<LicenseStatus> | null = null;

const isNativeRuntime = () => "__TAURI_INTERNALS__" in window;
const textOf = (node: Element | null) => (node?.textContent || "").replace(/\s+/g, " ").trim();
const escapeHtml = (value: unknown) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#039;");

const formatUnix = (value: number | null | undefined) => {
  if (!value) return "-";
  return new Date(value * 1000).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
};

const browserPreviewStatus = (): LicenseStatus => ({
  mode: "trial",
  canSell: true,
  reason: "browser_preview",
  deviceFingerprint: "DEV-PREVIEW",
  trialDaysTotal: 30,
  trialDaysRemaining: 30,
  trialExpiresAt: Math.floor(Date.now() / 1000) + 30 * 86_400,
  authorityConfigured: false,
  licenseId: null,
  customer: null,
  deviceLimit: null,
  licenseExpiresAt: null,
});

const nativeFailureStatus = (error: unknown): LicenseStatus => ({
  mode: "locked",
  canSell: false,
  reason: `native_license_check_failed:${String(error)}`,
  deviceFingerprint: "UNAVAILABLE",
  trialDaysTotal: 30,
  trialDaysRemaining: 0,
  trialExpiresAt: 0,
  authorityConfigured: false,
  licenseId: null,
  customer: null,
  deviceLimit: null,
  licenseExpiresAt: null,
});

const reasonText = (status: LicenseStatus) => {
  const reason = status.reason.toLowerCase();
  if (status.mode === "active") return "License ถูกต้องและผูกกับเครื่องนี้แล้ว";
  if (reason === "trial_active") return `กำลังทดลองใช้งาน เหลือ ${status.trialDaysRemaining} วัน`;
  if (reason === "browser_preview") return "โหมด Browser Preview สำหรับทีมพัฒนา";
  if (reason === "trial_expired") return "หมดช่วงทดลองใช้งานแล้ว กรุณาใส่ License จากฝ่าย IT";
  if (reason === "clock_rollback") return "ตรวจพบเวลาของเครื่องย้อนหลัง ระบบล็อกการขายชั่วคราว";
  if (reason === "license_missing_after_activation") return "ไม่พบ License ที่เคยเปิดใช้งาน ระบบล็อกการขายเพื่อป้องกันการลบ License แล้วเริ่ม Trial ใหม่";
  if (reason.includes("native_license_check_failed")) return "ระบบตรวจ License ฝั่ง Native ทำงานไม่สมบูรณ์ จึงล็อกการขายเพื่อความปลอดภัย";
  if (reason.includes("device_not_allowed")) return "License นี้ไม่ได้ออกให้เครื่องนี้";
  if (reason.includes("expired")) return "License หมดอายุแล้ว";
  if (reason.includes("signature")) return "ลายเซ็นดิจิทัลของ License ไม่ถูกต้อง";
  if (reason.includes("payload") || reason.includes("format") || reason.includes("product")) return "รูปแบบ License ไม่ถูกต้อง";
  return "License ไม่ผ่านการตรวจสอบ ระบบล็อกการขายชั่วคราว";
};

const activationErrorText = (error: unknown) => {
  const raw = String(error instanceof Error ? error.message : error).toUpperCase();
  if (raw.includes("LICENSE_CODE_REQUIRED")) return "กรุณาใส่รหัส License";
  if (raw.includes("LICENSE_AUTHORITY_NOT_CONFIGURED")) return "โปรแกรมรุ่นนี้ยังไม่ได้ฝัง Public Key ของฝ่าย IT";
  if (raw.includes("LICENSE_DEVICE_NOT_ALLOWED")) return "License นี้ไม่ได้ออกให้รหัสเครื่องนี้";
  if (raw.includes("LICENSE_EXPIRED")) return "License หมดอายุแล้ว";
  if (raw.includes("LICENSE_SIGNATURE_INVALID")) return "License ไม่ได้ลงนามโดยฝ่าย IT หรือข้อมูล License ถูกแก้ไข";
  if (raw.includes("LICENSE_FORMAT_INVALID") || raw.includes("LICENSE_PAYLOAD_INVALID")) return "รูปแบบรหัส License ไม่ถูกต้อง";
  if (raw.includes("LICENSE_PRODUCT_INVALID")) return "License นี้ไม่ใช่ของ CpIPOS Desktop";
  return `เปิดใช้งานไม่สำเร็จ: ${String(error)}`;
};

const syncLegacyConfig = (status: LicenseStatus) => {
  try {
    localStorage.setItem(LEGACY_FREE_MODE_KEY, "0");
    const saved = JSON.parse(localStorage.getItem(LEGACY_CONFIG_KEY) || "{}") as Record<string, unknown>;
    const previous = typeof saved.license === "object" && saved.license ? saved.license as Record<string, unknown> : {};
    saved.license = {
      ...previous,
      key: status.licenseId ? `SIGNED:${status.licenseId}` : "",
      token: status.mode === "active" ? "NATIVE-ED25519" : "",
      packageName: status.mode === "active" ? "Offline Licensed" : "Trial / Test",
      status: status.mode === "active" ? "active" : status.mode === "trial" ? "trial" : "expired",
      deviceFingerprint: status.deviceFingerprint,
      expiresAt: status.licenseExpiresAt ? new Date(status.licenseExpiresAt * 1000).toISOString() : "",
      lastCheckedAt: new Date().toISOString(),
    };
    localStorage.setItem(LEGACY_CONFIG_KEY, JSON.stringify(saved));
  } catch {
    // Native state is authoritative.
  }
};

const copyFingerprint = (fingerprint: string) => {
  if (navigator.clipboard) void navigator.clipboard.writeText(fingerprint);
};

const activateLicense = async (licenseCode: string) => {
  if (!isNativeRuntime()) throw new Error("NATIVE_RUNTIME_REQUIRED");
  const normalized = licenseCode.replace(/\s+/g, "").trim();
  if (!normalized) throw new Error("LICENSE_CODE_REQUIRED");
  const status = await invoke<LicenseStatus>("activate_offline_license", { licenseCode: normalized });
  applyStatus(status);
  return status;
};

const renderGate = (status: LicenseStatus) => {
  document.getElementById(TRIAL_BADGE_ID)?.remove();
  const existing = document.getElementById(LOCK_GATE_ID);
  if (status.mode !== "locked") {
    existing?.remove();
    return;
  }

  const signature = [status.reason, status.deviceFingerprint, status.authorityConfigured].join("|");
  if (existing?.dataset.licenseSignature === signature) return;

  const gate = existing || document.createElement("div");
  gate.id = LOCK_GATE_ID;
  gate.className = "cpipos-license-gate";
  gate.dataset.licenseSignature = signature;
  gate.innerHTML = `
    <section class="cpipos-license-gate-card" role="dialog" aria-modal="true" aria-label="CpIPOS License">
      <div class="cpipos-license-gate-logo">CpIPOS Desktop</div>
      <span class="cpipos-license-pill">OFFLINE LICENSE REQUIRED</span>
      <h1>โปรแกรมถูกล็อกการใช้งานชั่วคราว</h1>
      <p>${escapeHtml(reasonText(status))}</p>
      <div class="cpipos-license-device-box">
        <span>รหัสเครื่องสำหรับส่งให้ฝ่าย IT</span>
        <strong>${escapeHtml(status.deviceFingerprint)}</strong>
        <button type="button" data-license-copy>คัดลอกรหัสเครื่อง</button>
      </div>
      <label class="cpipos-license-input-label">รหัส License ที่ออกโดยฝ่าย IT ของ CUTTING POINT TECH CO., LTD.
        <textarea rows="4" spellcheck="false" autocomplete="off" data-license-input placeholder="CPIPOS1...."></textarea>
      </label>
      <button class="cpipos-license-activate" type="button" data-license-activate>ตรวจสอบและเปิดใช้งาน</button>
      <p class="cpipos-license-activation-status" data-license-message>${status.authorityConfigured ? "ตรวจสอบ License แบบ Offline ด้วยลายเซ็นดิจิทัล" : "ยังไม่ได้ตั้ง Public Key ของฝ่าย IT ในรุ่นนี้"}</p>
    </section>`;

  if (!existing) document.body.appendChild(gate);
  gate.querySelector<HTMLButtonElement>("[data-license-copy]")?.addEventListener("click", () => {
    copyFingerprint(status.deviceFingerprint);
    const message = gate.querySelector<HTMLElement>("[data-license-message]");
    if (message) message.textContent = "คัดลอกรหัสเครื่องแล้ว";
  });
  gate.querySelector<HTMLButtonElement>("[data-license-activate]")?.addEventListener("click", async () => {
    const input = gate.querySelector<HTMLTextAreaElement>("[data-license-input]");
    const button = gate.querySelector<HTMLButtonElement>("[data-license-activate]");
    const message = gate.querySelector<HTMLElement>("[data-license-message]");
    if (!input || !button || !message) return;
    button.disabled = true;
    message.textContent = "กำลังตรวจลายเซ็นและรหัสเครื่อง...";
    try {
      await activateLicense(input.value);
      message.textContent = "เปิดใช้งานสำเร็จ";
    } catch (error) {
      message.textContent = activationErrorText(error);
      button.disabled = false;
    }
  });
};

const renderTrialBadge = (status: LicenseStatus) => {
  document.getElementById(LOCK_GATE_ID)?.remove();
  const old = document.getElementById(TRIAL_BADGE_ID) as HTMLButtonElement | null;
  if (status.mode !== "trial" || status.reason === "browser_preview") {
    old?.remove();
    return;
  }
  const badge = old || document.createElement("button");
  badge.id = TRIAL_BADGE_ID;
  badge.className = "cpipos-license-trial-badge";
  badge.type = "button";
  badge.textContent = `ทดลองใช้งาน · เหลือ ${status.trialDaysRemaining} วัน`;
  badge.title = `หมดช่วงทดลอง ${formatUnix(status.trialExpiresAt)} · รหัสเครื่อง ${status.deviceFingerprint}`;
  if (!old) document.body.appendChild(badge);
};

const licensePanelHtml = (status: LicenseStatus) => {
  const title = status.mode === "active" ? "เปิดใช้งานแล้ว" : status.mode === "trial" ? "ทดลองใช้งาน" : "ถูกล็อก";
  return `<div class="commercial-card cpipos-native-license-card">
    <span class="commercial-kicker">Offline signed license</span><h3>รหัส License จากฝ่าย IT เท่านั้น</h3>
    <p>ระบบตรวจ License แบบ Offline ด้วย Ed25519 และผูกกับรหัสเครื่องที่ฝ่าย IT อนุมัติ รหัสที่สร้างเองหรือถูกแก้ไขจะไม่ผ่านการตรวจสอบ</p>
    <div class="commercial-license-grid">
      <div><span>สถานะ</span><strong>${escapeHtml(title)}</strong></div>
      <div><span>ทดลองเหลือ</span><strong>${status.mode === "trial" ? `${status.trialDaysRemaining} วัน` : "-"}</strong></div>
      <div><span>จำนวนเครื่องตาม License</span><strong>${status.deviceLimit ?? "-"}</strong></div>
    </div>
    <label>รหัสเครื่อง<input readonly value="${escapeHtml(status.deviceFingerprint)}" /></label>
    <label>รหัส License ที่ออกโดย IT<textarea rows="4" data-native-license-code spellcheck="false" placeholder="CPIPOS1...."></textarea></label>
    <div class="commercial-button-row"><button type="button" data-native-copy>คัดลอกรหัสเครื่อง</button><button type="button" data-native-activate>ตรวจสอบและเปิดใช้งาน</button></div>
    <div class="commercial-summary"><span>License ID: ${escapeHtml(status.licenseId || "-")}</span><span>ลูกค้า: ${escapeHtml(status.customer || "-")}</span><span>หมดอายุ: ${escapeHtml(formatUnix(status.licenseExpiresAt))}</span></div>
    <p class="commercial-status" data-native-status>${escapeHtml(reasonText(status))}</p>
  </div>`;
};

const syncSettingsPanel = () => {
  if (!currentStatus) return;
  const body = document.querySelector<HTMLElement>(".modal .settings-modal-body");
  if (!body) return;
  const modalTitle = textOf(document.querySelector(".modal header h2"));
  if (!modalTitle.includes("ลายเส้นโปรแกรม") && !modalTitle.includes("Program License") && !modalTitle.includes("License")) return;

  body.dataset.commercialEnhanced = "license";
  let host = body.querySelector<HTMLElement>(".commercial-settings-extension");
  if (!host) {
    host = document.createElement("div");
    host.className = "commercial-settings-extension";
    const footer = body.querySelector(".actions.modal-footer");
    body.insertBefore(host, footer || null);
  }

  const signature = [currentStatus.mode, currentStatus.reason, currentStatus.deviceFingerprint, currentStatus.licenseId, currentStatus.trialDaysRemaining].join("|");
  if (host.dataset.nativeLicenseSignature === signature) return;
  host.dataset.nativeLicenseSignature = signature;
  host.innerHTML = licensePanelHtml(currentStatus);

  host.querySelector<HTMLButtonElement>("[data-native-copy]")?.addEventListener("click", () => {
    copyFingerprint(currentStatus!.deviceFingerprint);
    const node = host!.querySelector<HTMLElement>("[data-native-status]");
    if (node) node.textContent = "คัดลอกรหัสเครื่องแล้ว ส่งรหัสนี้ให้ฝ่าย IT เพื่อออก License";
  });
  host.querySelector<HTMLButtonElement>("[data-native-activate]")?.addEventListener("click", async () => {
    const input = host!.querySelector<HTMLTextAreaElement>("[data-native-license-code]");
    const button = host!.querySelector<HTMLButtonElement>("[data-native-activate]");
    const node = host!.querySelector<HTMLElement>("[data-native-status]");
    if (!input || !button || !node) return;
    button.disabled = true;
    node.textContent = "กำลังตรวจสอบ License...";
    try {
      await activateLicense(input.value);
      node.textContent = "เปิดใช้งานสำเร็จ";
    } catch (error) {
      node.textContent = activationErrorText(error);
      button.disabled = false;
    }
  });
};

const syncReleasePanel = () => {
  if (!currentStatus) return;
  const body = document.querySelector<HTMLElement>(".modal .settings-modal-body");
  if (!body) return;
  const title = textOf(document.querySelector(".modal header h2"));
  if (!title.includes("เวอร์ชัน") && !title.includes("Version")) return;
  const host = body.querySelector<HTMLElement>(".commercial-settings-extension");
  if (!host || !textOf(host).includes("Free Forever")) return;
  body.dataset.commercialEnhanced = "release";
  host.innerHTML = `<div class="commercial-card"><span class="commercial-kicker">Installer Release</span><h3>Offline License Protected Build</h3><p>รุ่นลูกค้าใช้ Trial ${currentStatus.trialDaysTotal} วัน แล้วล็อกการขายเมื่อไม่มี License ที่ลงนามถูกต้อง</p><div class="commercial-summary"><span>License mode: Signed Offline</span><span>Device binding: เปิด</span><span>Authority: ${currentStatus.authorityConfigured ? "Configured" : "Not configured"}</span></div></div>`;
};

const applyStatus = (status: LicenseStatus) => {
  currentStatus = status;
  window.__CPIPOS_LICENSE_STATUS__ = status;
  document.documentElement.dataset.cpiposLicenseMode = status.mode;
  syncLegacyConfig(status);
  renderGate(status);
  renderTrialBadge(status);
  window.requestAnimationFrame(() => {
    syncSettingsPanel();
    syncReleasePanel();
  });
  window.dispatchEvent(new CustomEvent("cpipos:license-status", { detail: status }));
};

const refreshStatus = async (): Promise<LicenseStatus> => {
  if (refreshInFlight) return refreshInFlight;
  if (!isNativeRuntime()) {
    const preview = browserPreviewStatus();
    applyStatus(preview);
    return preview;
  }

  refreshInFlight = invoke<LicenseStatus>("get_license_status")
    .catch((error: unknown) => nativeFailureStatus(error))
    .then(status => {
      applyStatus(status);
      return status;
    })
    .finally(() => { refreshInFlight = null; });
  return refreshInFlight;
};

const blockSaleWhenLocked = (event: Event) => {
  if (currentStatus?.canSell !== false) return;
  const target = event.target instanceof HTMLElement ? event.target : null;
  const action = target?.closest("button, [role='button']");
  if (!action || !SALE_ACTION.test(textOf(action))) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  renderGate(currentStatus);
};

const startLicenseRuntime = () => {
  try { localStorage.setItem(LEGACY_FREE_MODE_KEY, "0"); } catch { /* noop */ }
  void refreshStatus();
  window.__CPIPOS_LICENSE__ = { refresh: refreshStatus, activate: activateLicense, getStatus: () => currentStatus };

  document.addEventListener("click", blockSaleWhenLocked, true);
  const observer = new MutationObserver(() => window.requestAnimationFrame(() => {
    syncSettingsPanel();
    syncReleasePanel();
  }));
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("focus", () => void refreshStatus());
  window.setInterval(() => void refreshStatus(), 30_000);
};

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startLicenseRuntime, { once: true });
else startLicenseRuntime();

export {};
