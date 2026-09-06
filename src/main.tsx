import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./pos-keyboard-shortcuts";
import "./styles.css";
import "./retail-ui.css";
import "./receipt-print.css";
import "./grocery-empty-branding.css";
import "./sales-scan-qty-ui.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
