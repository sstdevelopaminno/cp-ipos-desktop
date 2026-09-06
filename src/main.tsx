import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./pos-keyboard-shortcuts";
import "./inventory-barcode-enhancements";
import "./styles.css";
import "./retail-ui.css";
import "./receipt-print.css";
import "./grocery-empty-branding.css";
import "./sales-scan-qty-ui.css";
import "./inventory-barcode-enhancements.css";
import "./reports-dashboard-overrides.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
