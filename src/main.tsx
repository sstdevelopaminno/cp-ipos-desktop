import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./browser-printer-preview-unblock";
import App from "./App";
import "./login-security-guard";
import "./pos-keyboard-shortcuts";
import "./sales-pos-input-fixes";
import "./sales-keyboard-control";
import "./inventory-barcode-enhancements";
import "./desktop-scroll-runtime";
import "./settings-commercial-runtime";
import "./styles.css";
import "./retail-ui.css";
import "./receipt-print.css";
import "./grocery-empty-branding.css";
import "./sales-scan-qty-ui.css";
import "./sales-responsive-fit.css";
import "./sales-pos-input-fixes.css";
import "./inventory-barcode-enhancements.css";
import "./reports-dashboard-overrides.css";
import "./sales-history-desktop-scroll.css";
import "./settings-desktop-scroll.css";
import "./settings-commercial-runtime.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
