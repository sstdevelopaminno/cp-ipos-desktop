import type { ReactNode } from "react";
import "./retail-ui.css";

type NavItem = { id: string; label: string; icon: "sale" | "stock" | "history" | "report" | "staff" | "settings" | "close" };

type Props = {
  collapsed: boolean;
  active: string;
  items: NavItem[];
  onToggle: () => void;
  onSelect: (id: string) => void;
};

const paths: Record<NavItem["icon"], ReactNode> = {
  sale: <><path d="M4 6h16v12H4z"/><path d="M8 10h8M8 14h5"/></>,
  stock: <><path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5z"/><path d="M12 12 4 7.5M12 12l8-4.5M12 12v9"/></>,
  history: <><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5M12 7v5l3 2"/></>,
  report: <><path d="M5 20V10M12 20V4M19 20v-7"/><path d="M3 20h18"/></>,
  staff: <><circle cx="9" cy="8" r="3"/><path d="M3 20c0-4 2.5-7 6-7s6 3 6 7"/><path d="M17 8h4M19 6v4"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.8 1.8 0 0 0 .36 1.98l.05.05-2.83 2.83-.05-.05A1.8 1.8 0 0 0 15 19.4a1.8 1.8 0 0 0-1 .6 1.8 1.8 0 0 0-.4 1.1V21H9.6v-.1A1.8 1.8 0 0 0 8.5 19.4a1.8 1.8 0 0 0-1.98.36l-.05.05-2.83-2.83.05-.05A1.8 1.8 0 0 0 4.6 15a1.8 1.8 0 0 0-.6-1 1.8 1.8 0 0 0-1.1-.4H3V9.6h.1A1.8 1.8 0 0 0 4.6 8.5a1.8 1.8 0 0 0-.36-1.98l-.05-.05 2.83-2.83.05.05A1.8 1.8 0 0 0 9 4.6a1.8 1.8 0 0 0 1-.6 1.8 1.8 0 0 0 .4-1.1V3h4v.1A1.8 1.8 0 0 0 15.5 4.6a1.8 1.8 0 0 0 1.98-.36l.05-.05 2.83 2.83-.05.05A1.8 1.8 0 0 0 19.4 9c.4.3.8.6 1 .6h.6v4h-.6c-.2 0-.6.3-1 .6z"/></>,
  close: <><path d="M5 4h10a2 2 0 0 1 2 2v2"/><path d="M17 16v2a2 2 0 0 1-2 2H5z"/><path d="M9 12h12"/><path d="m17 8 4 4-4 4"/></>
};

function NavIcon({ name }: { name: NavItem["icon"] }) {
  return <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export function AppSidebar({ collapsed, active, items, onToggle, onSelect }: Props) {
  const openCloseShift = () => {
    const topbarCloseButton = document.querySelector<HTMLButtonElement>(".topbar-meta button");
    topbarCloseButton?.click();
  };

  return <aside className={`side-nav retail-side-nav ${collapsed ? "collapsed" : ""}`}>
    <div className="side-brand retail-side-brand">
      <img src="/icon.png" alt="CpIPOS" />
      {!collapsed && <div><strong>CpIPOS</strong><small>Desktop POS</small></div>}
    </div>
    <button className="nav-collapse-button" onClick={onToggle} title={collapsed ? "ขยายเมนู" : "ย่อเมนู"} aria-label={collapsed ? "ขยายเมนู" : "ย่อเมนู"}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d={collapsed ? "m9 18 6-6-6-6" : "m15 18-6-6 6-6"}/></svg>
      {!collapsed && <span>ย่อเมนู</span>}
    </button>
    <nav className="retail-nav-list">
      {items.map(item => <button key={item.id} className={active === item.id ? "active" : ""} onClick={() => onSelect(item.id)} title={collapsed ? item.label : undefined}>
        <NavIcon name={item.icon} />
        {!collapsed && <span>{item.label}</span>}
      </button>)}
    </nav>
    <button className="nav-close-shift-button" onClick={openCloseShift} title={collapsed ? "ปิดยอด" : undefined}>
      <NavIcon name="close" />
      {!collapsed && <span>ปิดยอด</span>}
    </button>
  </aside>;
}
