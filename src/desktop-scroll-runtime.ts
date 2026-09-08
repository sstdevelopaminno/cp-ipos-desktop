const isElement = (node: Element | null): node is HTMLElement => node instanceof HTMLElement;

const setStyles = (el: HTMLElement | null, styles: Partial<CSSStyleDeclaration>) => {
  if (!el) return;
  Object.entries(styles).forEach(([key, value]) => {
    if (value == null) return;
    el.style.setProperty(key.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`), String(value), "important");
  });
};

const isSettingsPanel = (panel: HTMLElement) => {
  const text = panel.textContent || "";
  return text.includes("CpIPOS Settings") || text.includes("เลือกหมวดที่ต้องการตั้งค่า") || text.includes("ข้อมูลร้าน");
};

const applySalesHistoryGuard = (viewBody: HTMLElement) => {
  const page = viewBody.querySelector<HTMLElement>(".sales-history-page");
  if (!page) return false;

  viewBody.classList.add("sales-history-view");
  setStyles(viewBody, {
    height: "100%",
    minHeight: "0",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  });
  setStyles(page, {
    flex: "1 1 auto",
    height: "100%",
    minHeight: "0",
    maxHeight: "100%",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  });

  page.querySelectorAll<HTMLElement>(".sales-history-toolbar,.sales-history-periods,.sales-history-filters,.sales-history-pagination")
    .forEach(el => setStyles(el, { flex: "0 0 auto" }));

  const shell = page.querySelector<HTMLElement>(".sales-history-table-shell");
  setStyles(shell, {
    flex: "1 1 auto",
    minHeight: "160px",
    height: "auto",
    maxHeight: "none",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  });
  setStyles(shell?.querySelector<HTMLElement>(".sales-history-table-summary") || null, { flex: "0 0 auto" });

  const wrap = page.querySelector<HTMLElement>(".sales-history-table-wrap");
  setStyles(wrap, {
    flex: "1 1 auto",
    minHeight: "0",
    height: "auto",
    maxHeight: "none",
    overflowY: "auto",
    overflowX: "auto",
    overscrollBehavior: "contain",
    scrollbarGutter: "stable both-edges",
  });

  return true;
};

const applySettingsGuard = (viewBody: HTMLElement) => {
  const directPanel = Array.from(viewBody.children).find(child => isElement(child) && child.classList.contains("panel") && isSettingsPanel(child)) as HTMLElement | undefined;
  if (!directPanel) return false;

  viewBody.classList.add("settings-view");
  setStyles(viewBody, {
    height: "100%",
    minHeight: "0",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  });
  setStyles(directPanel, {
    flex: "1 1 auto",
    height: "100%",
    minHeight: "0",
    maxHeight: "100%",
    overflowY: "auto",
    overflowX: "hidden",
    overscrollBehavior: "contain",
    scrollbarGutter: "stable",
    paddingBottom: "30px",
  });

  return true;
};

const applyViewport = () => {
  const height = Math.round(window.visualViewport?.height || window.innerHeight || 768);
  document.documentElement.style.setProperty("--app-vh", `${height}px`);
  setStyles(document.querySelector<HTMLElement>(".app-shell"), {
    height: "var(--app-vh, 100vh)",
    maxHeight: "var(--app-vh, 100vh)",
    overflow: "hidden",
  });
};

const applyScrollGuards = () => {
  applyViewport();
  document.querySelectorAll<HTMLElement>(".view-body").forEach(viewBody => {
    const handled = applySalesHistoryGuard(viewBody) || applySettingsGuard(viewBody);
    if (!handled) {
      viewBody.classList.remove("sales-history-view", "settings-view");
      viewBody.style.removeProperty("display");
      viewBody.style.removeProperty("flex-direction");
    }
  });
};

const start = () => {
  applyScrollGuards();
  window.setTimeout(applyScrollGuards, 50);
  window.setTimeout(applyScrollGuards, 250);
  window.setTimeout(applyScrollGuards, 800);

  const observer = new MutationObserver(() => {
    window.requestAnimationFrame(applyScrollGuards);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  window.addEventListener("resize", applyScrollGuards);
  window.visualViewport?.addEventListener("resize", applyScrollGuards);
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}

export {};