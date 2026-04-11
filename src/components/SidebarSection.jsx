
export function SidebarSection({ icon, title, children, open, onToggle, badge }) {
  return (
    <div className="sidebar-section">
      <button className="section-header" onClick={onToggle}>
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
