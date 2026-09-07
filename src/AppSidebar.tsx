import type { ReactNode } from "react";
import "./retail-ui.css";

type NavItem = { id: string; label: string; icon: "sale" | "stock" | "history" | "report" | "staff" | "settings" | "close" | "logout" };

type Props = {
  collapsed: boolean;
  compactLocked?: boolean;
  active: string;
  items: NavItem[];
  onToggle: () => void;
  onSelect: (id: string) => void;
  onCloseShift: () => void;
  onLogout: () => void;
};

const paths: Record<NavItem["icon"], ReactNode> = {
  sale: <><path d="M4 6h16v12H4z"/><path d="M8 10h8M8 14h5"/></>,
  stock: <><path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5z"/><path d="M12 12 4 7.5M12 12l8-4.5M12 12v9"/></>,
  history: <><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5M12 7v5l3 2"/></>,
  report: <><path d="M5 20V10M12 20V4M19 20v-7"/><path d="M3 20h18"/></>,
  staff: <><circle cx="9" cy="8" r="3"/><path d="M3 20c0-4 2.5-7 6-7s6 3 6 7"/><path d="M17 8h4M19 6v4"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.8 1.8 0 0 0 .36 1.98l.05.05-2.83 2.83-.05-.05A1.8 1.8 0 0 0 15 19.4a1.8 1.8 0 0 0-1 .6 1.8 1.8 0 0 0-.4 1.1V21H9.6v-.1A1.8 1.8 0 0 0 8.5 19.4a1.8 1.8 0 0 0-1.98.36l-.05.05-2.83-2.83.05-.05A1.8 1.8 0 0 0 4.6 15a1.8 1.8 0 0 0-.6-1 1.8 1.8 0 0 0-1.1-.4H3V9.6h.1A1.8 1.8 0 0 0 4.6 8.5a1.8 1.8 0 0 0-.36-1.98l-.05-.05 2.83-2.83.05.05A1.8 1.8 0 0 0 9 4.6a1.8 1.8 0 0 0 1-.6 1.8 1.8 0 0 0 .4-1.1V3h4v.1A1.8 1.8 0 0 0 15.5 4.6a1.8 1.8 0 0 0 1.98-.36l.05-.05 2.83 2.83-.05.05A1.8 1.8 0 0 0 19.4 9c.4.3.8.6 1 .6h.6v4h-.6c-.2 0-.6.3-1 .6z"/></>,
  close: <><path d="M6 5h12v4H6z"/><path d="M7 9h10v10H7z"/><path d="M9 13h6M9 16h4"/><path d="M5 19h14"/></>,
  logout: <><path d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4"/><path d="M14 16l4-4-4-4"/><path d="M18 12H9"/></>
};

function NavIcon({ name }: { name: NavItem["icon"] }) {
  return <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export function AppSidebar({ collapsed, compactLocked = false, active, items, onToggle, onSelect, onCloseShift, onLogout }: Props) {
  const toggleLabel = compactLocked ? "หน้าจอเล็ก ระบบย่อเมนูให้อัตโนมัติ" : collapsed ? "ขยายเมนู" : "ย่อเมนู";
  return <aside className={"side-nav retail-side-nav " + (collapsed ? "collapsed " : "") + (compactLocked ? "compact-locked" : "")}>
    <div className="side-brand retail-side-brand">
      <img src="/icon.png" alt="CpIPOS" />
      {!collapsed && <div><strong>CpIPOS</strong><small>Desktop POS</small></div>}
    </div>
    <button className="nav-collapse-button" onClick={onToggle} disabled={compactLocked} title={toggleLabel} aria-label={toggleLabel}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d={collapsed ? "m9 18 6-6-6-6" : "m15 18-6-6 6-6"}/></svg>
      {!collapsed && <span>ย่อเมนู</span>}
    </button>
    <nav className="retail-nav-list">
      {items.map(item => <button key={item.id} className={active === item.id ? "active" : ""} onClick={() => onSelect(item.id)} title={collapsed ? item.label : undefined}>
        <NavIcon name={item.icon} />
        {!collapsed && <span>{item.label}</span>}
      </button>)}
    </nav>
    <div className="nav-bottom-actions" aria-label="คำสั่งท้ายเมนู">
      <button className="nav-close-shift-button" onClick={onCloseShift} title={collapsed ? "ปิดยอด" : undefined} aria-label="ปิดยอด">
        <NavIcon name="close" />
        {!collapsed && <span>ปิดยอด</span>}
      </button>
      <button className="nav-logout-button" onClick={onLogout} title={collapsed ? "ล็อคเอาท์" : undefined} aria-label="ล็อคเอาท์">
        <NavIcon name="logout" />
        {!collapsed && <span>ล็อคเอาท์</span>}
      </button>
    </div>
  </aside>;
}
