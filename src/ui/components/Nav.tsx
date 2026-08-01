export const TABS = ['dashboard', 'products', 'scan', 'history'] as const

export type Tab = (typeof TABS)[number]

const LABELS: Record<Tab, string> = {
  dashboard: 'Dashboard',
  products: 'Products',
  scan: 'Scan',
  history: 'History',
}

const ICONS: Record<Tab, string> = {
  dashboard: '▦',
  products: '☰',
  scan: '⬒',
  history: '↻',
}

export interface NavProps {
  tab: Tab
  onChange: (tab: Tab) => void
}

/** A bottom tab bar on a phone, a sidebar on a desktop — same markup. */
export function Nav({ tab, onChange }: NavProps) {
  return (
    <nav className="nav" aria-label="Main">
      {TABS.map((value) => (
        <button
          key={value}
          type="button"
          className={`nav-item ${value === tab ? 'nav-item-active' : ''}`}
          aria-current={value === tab ? 'page' : undefined}
          onClick={() => onChange(value)}
        >
          <span className="nav-icon" aria-hidden="true">
            {ICONS[value]}
          </span>
          <span className="nav-label">{LABELS[value]}</span>
        </button>
      ))}
    </nav>
  )
}
