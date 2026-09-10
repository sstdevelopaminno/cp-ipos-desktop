import "./startup-blank-screen-guard";
import "./desktop-performance-guard";
import { StrictMode, Component, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./startup-stuck-recovery";
import "./browser-printer-preview-unblock";
import "./printer-first-run-fix";
import App from "./App";
import "./login-security-guard";
import "./pos-keyboard-shortcuts";
import "./sales-pos-input-fixes";
import "./sales-draft-finalize-guard";
import "./sales-draft-cart-runtime";
import "./sales-keyboard-control";
import "./inventory-barcode-enhancements";
import "./desktop-scroll-runtime";
import "./settings-commercial-runtime";
import "./shift-close-summary-runtime";
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
import "./printer-first-run-fix.css";
import "./shift-close-summary-runtime.css";
import "./startup-splash-polish.css";

declare global {
  interface Window {
    __CPIPOS_APP_RENDERED__?: boolean;
  }
}

type BootBoundaryState = {
  error: string;
};

class BootBoundary extends Component<{ children: ReactNode }, BootBoundaryState> {
  state: BootBoundaryState = { error: "" };

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    console.error("CpIPOS Desktop render failed", error, errorInfo);
    this.setState({ error: error instanceof Error ? error.message : "UNKNOWN_RENDER_ERROR" });
  }

  render() {
    if (this.state.error) {
      return (
        <main className="center-screen">
          <section className="error-card">
            <h1>CpIPOS เปิดหน้าหลักไม่สำเร็จ</h1>
            <p>{this.state.error}</p>
            <button className="big-primary" onClick={() => window.location.reload()}>ลองเปิดใหม่</button>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BootBoundary>
      <App />
    </BootBoundary>
  </StrictMode>
);
