import { useEffect, useState } from "react";
import type { PosRepository } from "../../data/repository";
import type { AppSettings, Language, Staff, StorageHealth } from "../../domain/types";
import "./desktop-settings-workspace.css";

type Section = "store" | "branch" | "payment" | "receipt" | "printer" | "scanner" | "storage" | "remote" | "about";

export function DesktopSettingsWorkspace({ repo, staff, settings, language, onSaved }: {
  repo: PosRepository;
  staff: Staff;
  settings: AppSettings;
  language: Language;
  onSaved: (settings: AppSettings) => void;
}) {
  const th = language === "th";
  const [section, setSection] = useState<Section>("store");
  const [form, setForm] = useState<AppSettings>({ ...settings });
  const [health, setHealth] = useState<StorageHealth | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => { setForm({ ...settings }); }, [settings]);
  useEffect(() => { void repo.getStorageHealth().then(setHealth); }, [repo]);

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => setForm((current) => ({ ...current, [key]: value }));
  const save = async () => {
    setSaving(true); setMessage("");
    try {
      const saved = await repo.updateSettings(form, staff);
      onSaved(saved);
      setMessage(th ? "บันทึกการตั้งค่าเรียบร้อย" : "Settings saved");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setSaving(false); }
  };

  const uploadQr = (file?: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setMessage(th ? "กรุณาเลือกไฟล์รูปภาพ QR" : "Please choose a QR image file."); return; }
    if (file.size > 2_000_000) { setMessage(th ? "รูป QR ต้องมีขนาดไม่เกิน 2 MB" : "QR image must be 2 MB or smaller."); return; }
    const reader = new FileReader();
    reader.onload = () => set("paymentQrImage", String(reader.result ?? ""));
    reader.onerror = () => setMessage(th ? "อ่านไฟล์ QR ไม่สำเร็จ" : "Could not read QR image.");
    reader.readAsDataURL(file);
  };

  const nav: Array<{ id: Section; label: string; hint: string }> = [
    { id: "store", label: th ? "ข้อมูลร้าน" : "Store", hint: th ? "ชื่อร้านและที่อยู่" : "Identity and address" },
    { id: "branch", label: th ? "สาขา / เครื่อง" : "Branch / Device", hint: th ? "ชื่อสาขาและเครื่อง POS" : "Branch and terminal" },
    { id: "payment", label: th ? "การชำระเงิน / QR" : "Payment / QR", hint: th ? "ภาพ QR สำหรับรับเงิน" : "Payment QR image" },
    { id: "receipt", label: th ? "ใบเสร็จ" : "Receipt", hint: th ? "หัวและท้ายใบเสร็จ" : "Receipt header/footer" },
    { id: "printer", label: th ? "เครื่องพิมพ์" : "Printer", hint: th ? "สถานะเครื่องพิมพ์" : "Printer status" },
    { id: "scanner", label: th ? "เครื่องสแกน" : "Scanner", hint: th ? "Barcode keyboard wedge" : "Barcode input" },
    { id: "storage", label: th ? "พื้นที่จัดเก็บ" : "Storage", hint: th ? "ฐานข้อมูลในเครื่อง" : "Local storage" },
    { id: "remote", label: th ? "เชื่อมต่อ IT" : "IT connection", hint: th ? "Remote management" : "Remote management" },
    { id: "about", label: th ? "เกี่ยวกับโปรแกรม" : "About", hint: "CpIPOS Desktop" }
  ];

  return <section className="desktop-settings-layout">
    <aside className="desktop-settings-nav"><header><h2>{th ? "ตั้งค่า" : "Settings"}</h2><p>{th ? "การตั้งค่าโปรแกรม POS เครื่องนี้" : "Local POS configuration"}</p></header>{nav.map((item) => <button key={item.id} className={section === item.id ? "active" : ""} onClick={() => setSection(item.id)}><strong>{item.label}</strong><small>{item.hint}</small></button>)}</aside>
    <section className="desktop-settings-panel">
      <header className="settings-panel-head"><div><h1>{nav.find((item) => item.id === section)?.label}</h1><p>{nav.find((item) => item.id === section)?.hint}</p></div><button className="settings-save" disabled={saving} onClick={() => void save()}>{saving ? (th ? "กำลังบันทึก..." : "Saving...") : (th ? "บันทึก" : "Save")}</button></header>

      {section === "store" ? <div className="settings-card settings-form-grid"><label>{th ? "ชื่อร้าน" : "Store name"}<input value={form.storeName} onChange={(event) => set("storeName", event.target.value)}/></label><label>{th ? "ชื่อเจ้าของ" : "Owner"}<input value={form.ownerName} onChange={(event) => set("ownerName", event.target.value)}/></label><label className="wide">{th ? "ที่อยู่" : "Address"}<input value={form.address} onChange={(event) => set("address", event.target.value)}/></label><label>{th ? "เบอร์โทร" : "Phone"}<input value={form.phone} onChange={(event) => set("phone", event.target.value)}/></label><label>{th ? "เลขผู้เสียภาษี" : "Tax ID"}<input value={form.taxId} onChange={(event) => set("taxId", event.target.value)}/></label></div> : null}

      {section === "branch" ? <div className="settings-card settings-form-grid"><label>{th ? "ชื่อสาขา" : "Branch name"}<input value={form.branchName} onChange={(event) => set("branchName", event.target.value)}/></label><label>{th ? "ชื่อเครื่อง POS" : "Device name"}<input value={form.deviceName} onChange={(event) => set("deviceName", event.target.value)}/></label><label className="wide">{th ? "Device ID ภายในโปรแกรม" : "Internal device ID"}<input value={form.deviceId} onChange={(event) => set("deviceId", event.target.value)}/></label><label>{th ? "ภาษา" : "Language"}<select value={form.language} onChange={(event) => set("language", event.target.value === "en" ? "en" : "th")}><option value="th">ไทย</option><option value="en">English</option></select></label></div> : null}

      {section === "payment" ? <div className="payment-settings-grid">
        <section className="settings-card"><div className="settings-card-title"><div><h3>{th ? "QR ชำระเงิน" : "Payment QR"}</h3><p>{th ? "ภาพนี้จะแสดงในหน้าชำระเงินโอน และพิมพ์ท้ายใบแจ้งชำระเงิน" : "Shown in transfer payment and printed at the bottom of payment notices."}</p></div><label className="switch-row"><input type="checkbox" checked={Boolean(form.paymentQrEnabled)} onChange={(event) => set("paymentQrEnabled", event.target.checked)}/><span>{th ? "เปิดใช้งาน" : "Enabled"}</span></label></div><label>{th ? "ชื่อบัญชี / ข้อความใต้ QR" : "Account label"}<input value={form.paymentQrAccountName ?? ""} onChange={(event) => set("paymentQrAccountName", event.target.value)} placeholder={th ? "เช่น พร้อมเพย์ บริษัท คัตติ้งพอยท์ เทค จำกัด" : "e.g. PromptPay account"}/></label><label>{th ? "หมายเหตุการชำระเงิน" : "Payment note"}<input value={form.paymentQrNote ?? ""} onChange={(event) => set("paymentQrNote", event.target.value)} placeholder={th ? "เช่น กรุณาแสดงหลักฐานหลังชำระ" : "Optional customer note"}/></label><div className="qr-upload-actions"><label className="qr-file-button">{th ? "เลือกภาพ QR" : "Choose QR image"}<input type="file" accept="image/*" onChange={(event) => uploadQr(event.target.files?.[0])}/></label>{form.paymentQrImage ? <button className="remove-qr" onClick={() => { set("paymentQrImage", ""); set("paymentQrEnabled", false); }}>{th ? "ลบ QR" : "Remove QR"}</button> : null}</div><small className="settings-help">{th ? "รองรับ PNG/JPG/WebP ขนาดไม่เกิน 2 MB ภาพจะเก็บไว้ในฐานข้อมูลการตั้งค่าของเครื่องนี้" : "PNG/JPG/WebP up to 2 MB. The image is stored in this terminal's local settings."}</small></section>
        <section className="settings-card qr-preview-card"><span>{th ? "ตัวอย่างหน้าชำระเงิน" : "Payment preview"}</span><strong>{th ? "สแกน QR เพื่อชำระเงิน" : "Scan QR to pay"}</strong>{form.paymentQrImage ? <img src={form.paymentQrImage} alt="QR preview"/> : <div className="qr-placeholder">QR</div>}<b>{form.paymentQrAccountName || (th ? "ยังไม่ได้ระบุชื่อบัญชี" : "No account label")}</b><small>{form.paymentQrEnabled && form.paymentQrImage ? (th ? "พร้อมใช้งาน" : "Ready") : (th ? "ยังไม่เปิดใช้งาน" : "Not enabled")}</small></section>
      </div> : null}

      {section === "receipt" ? <div className="settings-card settings-form-grid"><label>{th ? "หัวใบเสร็จ" : "Receipt header"}<input value={form.receiptHeader} onChange={(event) => set("receiptHeader", event.target.value)}/></label><label>{th ? "ท้ายใบเสร็จ" : "Receipt footer"}<input value={form.receiptFooter} onChange={(event) => set("receiptFooter", event.target.value)}/></label><div className="wide settings-info"><strong>{th ? "ใบเสร็จปกติจะไม่พิมพ์ QR" : "Normal receipts do not print the payment QR."}</strong><span>{th ? "QR จะอยู่เฉพาะใบแจ้งชำระเงินก่อนรับเงิน เพื่อแยกเอกสารให้ชัดเจน" : "The QR appears only on the pre-payment notice."}</span></div></div> : null}
      {section === "printer" ? <div className="settings-card"><h3>{th ? "เครื่องพิมพ์ใบเสร็จ" : "Receipt printer"}</h3><p>{form.printerType}</p><div className="settings-info"><strong>{th ? "การพิมพ์จากหน้าขาย" : "Sales printing"}</strong><span>{th ? "ปุ่มพิมพ์จะเปิด Print Dialog ของ Windows/Tauri ก่อน เมื่อเชื่อม Print Agent แล้วจะเปลี่ยนเป็นพิมพ์ตรงได้" : "Printing currently uses the Windows/Tauri print dialog; direct Print Agent routing can be connected next."}</span></div></div> : null}
      {section === "scanner" ? <div className="settings-card"><h3>Barcode Scanner</h3><p>{form.scannerMode}</p><div className="settings-info"><span>{th ? "รองรับเครื่องสแกนแบบ Keyboard Wedge: สแกนรหัสแล้วกด Enter อัตโนมัติ" : "Supports keyboard-wedge scanners that submit Enter after the barcode."}</span></div></div> : null}
      {section === "storage" ? <div className="settings-card"><h3>{th ? "พื้นที่จัดเก็บภายในเครื่อง" : "Local storage"}</h3>{health ? <div className="storage-metrics"><div><span>Database</span><strong>{Math.max(1, Math.round(health.databaseSize / 1024))} KB</strong></div><div><span>Media</span><strong>{Math.round(health.mediaSize / 1024)} KB</strong></div><div><span>Sales</span><strong>{health.salesCount}</strong></div><div><span>Audit</span><strong>{health.auditCount}</strong></div></div> : <p>{th ? "กำลังโหลด..." : "Loading..."}</p>}</div> : null}
      {section === "remote" ? <div className="settings-card"><h3>{th ? "เชื่อมต่อระบบ IT" : "IT connection"}</h3><label className="switch-row"><input type="checkbox" checked={form.remoteManagementEnabled} onChange={(event) => set("remoteManagementEnabled", event.target.checked)}/><span>{th ? "อนุญาต Remote Management เมื่อเครื่องออนไลน์" : "Allow remote management while online"}</span></label><p className="settings-help">{th ? "License และสิทธิ์โหมดขายตรวจจาก License Key ที่ลงลายเซ็นโดยระบบ IT แยกจากสวิตช์นี้" : "License and sales-mode entitlements are verified from the IT-signed License Key independently of this switch."}</p></div> : null}
      {section === "about" ? <div className="settings-card about-card"><img src="/icon.png" alt="CpIPOS"/><h2>CpIPOS Desktop</h2><strong>0.1.0</strong><p>CUTTING POINT TECH CO., LTD.</p></div> : null}
      {message ? <div className="settings-message">{message}</div> : null}
    </section>
  </section>;
}
