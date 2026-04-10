import React, { useState } from "react";

export function SidebarSection({ icon, title, children, defaultOpen = false, badge }) {
  const storageKey = `fpv-section-${title}`;
  const [open, setOpen] = useState(() => {
    try {
      const v = localStorage.getItem(storageKey);
      return v !== null ? v === "true" : defaultOpen;
    } catch {
      return defaultOpen;
    }
  });

  const toggle = () => {
    setOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(storageKey, String(next));
      } catch {}
      return next;
    });
  };

  return (
    <div className="sidebar-section">
      <button className="section-header" onClick={toggle}>
        <span className="section-icon">{icon}</span>
        <span className="section-title">{title}</span>
        {badge && <span className="section-badge">{badge}</span>}
        <span className={`section-chevron ${open ? "open" : ""}`}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>
      {open && <div className="section-content">{children}</div>}
    </div>
  );
}
