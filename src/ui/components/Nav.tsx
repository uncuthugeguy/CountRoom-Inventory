import {
  CheckoutIcon,
  CodesIcon,
  DashboardIcon,
  HistoryIcon,
  ProductsIcon,
  ReportsIcon,
  ReturnsIcon,
  ScanIcon,
  SettingsIcon,
  StocktakeIcon,
  SuppliersIcon,
} from './Icons'

export const TABS = [
  'dashboard',
  'products',
  'scan',
  'checkout',
  'returns',
  'stocktake',
  'history',
  'reports',
  'suppliers',
  'codes',
  'settings',
] as const

export type Tab = (typeof TABS)[number]

const LABELS: Record<Tab, string> = {
  dashboard: 'Dashboard',
  products: 'Products',
  scan: 'Scan',
  checkout: 'Checkout',
  returns: 'Returns',
  stocktake: 'Stocktake',
  history: 'History',
  reports: 'Reports',
  suppliers: 'Suppliers',
  codes: 'Quick codes',
  settings: 'Settings',
}

/** No emoji, no Unicode glyphs as icons — see Icons.tsx. */
const ICONS: Record<Tab, (props: { className?: string }) => JSX.Element> = {
  dashboard: DashboardIcon,
  products: ProductsIcon,
  scan: ScanIcon,
  checkout: CheckoutIcon,
  returns: ReturnsIcon,
  stocktake: StocktakeIcon,
  history: HistoryIcon,
  reports: ReportsIcon,
  suppliers: SuppliersIcon,
  codes: CodesIcon,
  settings: SettingsIcon,
}

export interface NavProps {
  tab: Tab
  onChange: (tab: Tab) => void
  /** Tabs left out of the bar entirely — e.g. 'codes' for an employee, since
   * the quick codes library is manager-only. */
  hiddenTabs?: readonly Tab[]
}

/** A bottom tab bar on a phone, a sidebar on a desktop — same markup. */
export function Nav({ tab, onChange, hiddenTabs = [] }: NavProps) {
  return (
    <nav className="nav" aria-label="Main">
      {TABS.filter((value) => !hiddenTabs.includes(value)).map((value) => (
        <button
          key={value}
          type="button"
          className={`nav-item ${value === tab ? 'nav-item-active' : ''}`}
          aria-current={value === tab ? 'page' : undefined}
          onClick={() => onChange(value)}
        >
          <span className="nav-icon">
            {(() => {
              const Icon = ICONS[value]
              return <Icon />
            })()}
          </span>
          <span className="nav-label">{LABELS[value]}</span>
        </button>
      ))}
    </nav>
  )
}
