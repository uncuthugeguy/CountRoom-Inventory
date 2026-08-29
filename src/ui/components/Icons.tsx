/**
 * Small inline icon set standing in for the design system's specified
 * Lucide set (see the "CountRoom Design System" project — ICONOGRAPHY:
 * "Substitution flagged: the system specifies Lucide... Replace with a real
 * CountRoom UI icon set when one exists"). Hand-drawn in the same spirit —
 * 24x24, single 2px stroke, rounded caps, no fill — so the nav bar and
 * dialogs stop relying on raw Unicode/emoji glyphs, which the system
 * explicitly rules out ("No emoji. No unicode characters as icons.").
 *
 * Every icon inherits its color from `currentColor`, sized by the .nav-icon
 * / .icon-button svg rules in styles.css.
 */

type IconProps = { className?: string }

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export function DashboardIcon(props: IconProps) {
  return (
    <svg {...base} {...props} aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  )
}

export function ProductsIcon(props: IconProps) {
  return (
    <svg {...base} {...props} aria-hidden="true">
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="14" y2="18" />
    </svg>
  )
}

export function ScanIcon(props: IconProps) {
  return (
    <svg {...base} {...props} aria-hidden="true">
      <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8" />
      <path d="M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8" />
      <path d="M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16" />
      <path d="M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
      <line x1="4" y1="12" x2="20" y2="12" />
    </svg>
  )
}

export function CheckoutIcon(props: IconProps) {
  return (
    <svg {...base} {...props} aria-hidden="true">
      <circle cx="9" cy="20" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="18" cy="20" r="1.4" fill="currentColor" stroke="none" />
      <path d="M2.5 4h2l2.2 11.2a1.8 1.8 0 0 0 1.8 1.5h8.7a1.8 1.8 0 0 0 1.77-1.47L20.5 8H6.2" />
    </svg>
  )
}

export function ReturnsIcon(props: IconProps) {
  return (
    <svg {...base} {...props} aria-hidden="true">
      <polyline points="8 6 3 11 8 16" />
      <path d="M3 11h11a6 6 0 0 1 0 12h-2" />
    </svg>
  )
}

export function StocktakeIcon(props: IconProps) {
  return (
    <svg {...base} {...props} aria-hidden="true">
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M9 3h6v2.5H9z" fill="currentColor" stroke="none" />
      <polyline points="8.5 13 10.5 15 15.5 10" />
    </svg>
  )
}

export function HistoryIcon(props: IconProps) {
  return (
    <svg {...base} {...props} aria-hidden="true">
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
      <polyline points="3 3.5 3.5 6.5 6.6 6" />
      <polyline points="12 7.5 12 12 15.5 13.8" />
    </svg>
  )
}

export function ReportsIcon(props: IconProps) {
  return (
    <svg {...base} {...props} aria-hidden="true">
      <line x1="6" y1="20" x2="6" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="18" y1="20" x2="18" y2="14" />
    </svg>
  )
}

export function SuppliersIcon(props: IconProps) {
  return (
    <svg {...base} {...props} aria-hidden="true">
      <rect x="1" y="7" width="14" height="10" rx="1" />
      <path d="M15 10h4l3 3v4h-7z" />
      <circle cx="6" cy="19" r="1.6" />
      <circle cx="17.5" cy="19" r="1.6" />
    </svg>
  )
}

export function CodesIcon(props: IconProps) {
  return (
    <svg {...base} {...props} aria-hidden="true">
      <line x1="4" y1="4" x2="4" y2="20" />
      <line x1="8" y1="4" x2="8" y2="20" />
      <line x1="12.5" y1="4" x2="12.5" y2="20" strokeWidth="3.5" />
      <line x1="16" y1="4" x2="16" y2="20" />
      <line x1="20" y1="4" x2="20" y2="20" strokeWidth="3.5" />
    </svg>
  )
}

export function SettingsIcon(props: IconProps) {
  return (
    <svg {...base} {...props} aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z" />
    </svg>
  )
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...base} {...props} strokeWidth={2.2} aria-hidden="true">
      <line x1="5" y1="5" x2="19" y2="19" />
      <line x1="19" y1="5" x2="5" y2="19" />
    </svg>
  )
}
