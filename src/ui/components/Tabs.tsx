export interface TabDef {
  route: string;
  label: string;
  /** SVG path data on a 24x24 grid, drawn as a stroke. */
  iconPath: string;
}

/** Bottom tab bar on phones, top bar on wide screens (layout handled in CSS). */
export function Tabs({ tabs, active }: { tabs: TabDef[]; active: string }) {
  return (
    <nav className="tabs" aria-label="Main">
      <span className="tabs-brand" aria-hidden="true">
        Tally
      </span>
      {tabs.map((t) => (
        <a key={t.route} href={`#/${t.route}`} className="tab" aria-current={t.route === active ? 'page' : undefined}>
          <svg className="tab-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d={t.iconPath} />
          </svg>
          <span className="tab-label">{t.label}</span>
        </a>
      ))}
    </nav>
  );
}
