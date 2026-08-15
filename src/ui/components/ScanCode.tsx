import type { ReactNode } from 'react'
import { encodeQr } from '../../printing/qrRender'
import { CODE128_QUIET_ZONE_MODULES, encodeCode128 } from '../../printing/code128Render'

export interface ScanCodeProps {
  value: string
  /** Which symbology to render `value` as — matches the saved `QuickCode`'s
   * `format`. Defaults to 'qr'. */
  format?: 'qr' | 'code128'
  /** Rendered size in CSS pixels. Square for a QR code; for a Code 128
   * barcode this is the width, with the height scaled to a normal barcode
   * aspect ratio rather than forced square. */
  size?: number
}

/** Modules of quiet zone (blank border) around a QR code, on every side —
 * scanners rely on this margin to detect the code's edges. Code 128 needs a
 * much wider margin; see `CODE128_QUIET_ZONE_MODULES`. */
const QR_QUIET_ZONE_MODULES = 2

/** How tall a Code 128 barcode's bars are, in the same module units as
 * their width — purely a display choice, not part of the symbology. */
const CODE128_BAR_HEIGHT_MODULES = 40

const FALLBACK_MESSAGE = "Couldn't generate a scannable code for this value."

/**
 * Renders `value` as a fresh, scannable code — always on a plain white
 * background with pure black modules, regardless of the app's own theme,
 * since a scanner (a phone camera, or the printer's own scan-to-configure
 * feature) needs real contrast, not whatever colours look good in dark mode.
 */
export function ScanCode({ value, format = 'qr', size = 240 }: ScanCodeProps) {
  if (format === 'code128') {
    const bars = encodeCode128(value)

    if (!bars) {
      return (
        <div className="scan-code-fallback" style={{ width: size, height: size * 0.35 }}>
          <p>{FALLBACK_MESSAGE}</p>
          <code>{value}</code>
        </div>
      )
    }

    const total = bars.width + CODE128_QUIET_ZONE_MODULES * 2
    const cells: ReactNode[] = []
    for (let x = 0; x < bars.width; x++) {
      if (bars.isDark(x)) {
        cells.push(
          <rect
            key={x}
            x={x + CODE128_QUIET_ZONE_MODULES}
            y={0}
            width={1}
            height={CODE128_BAR_HEIGHT_MODULES}
          />,
        )
      }
    }

    return (
      <svg
        viewBox={`0 0 ${total} ${CODE128_BAR_HEIGHT_MODULES}`}
        width={size}
        height={size * 0.35}
        preserveAspectRatio="none"
        role="img"
        aria-label="Scannable code"
        // Not part of the symbology — a plain hook for anything that needs
        // the raw value a scan of this code would produce (tests simulating
        // a wedge scan of a printed receipt; a person hovering to
        // sanity-check it).
        data-scan-value={value}
        style={{ background: '#fff', borderRadius: 8, shapeRendering: 'crispEdges' }}
      >
        <g fill="#000">{cells}</g>
      </svg>
    )
  }

  const matrix = encodeQr(value)

  if (!matrix) {
    return (
      <div className="scan-code-fallback" style={{ width: size, height: size }}>
        <p>{FALLBACK_MESSAGE}</p>
        <code>{value}</code>
      </div>
    )
  }

  const total = matrix.size + QR_QUIET_ZONE_MODULES * 2
  const cells: ReactNode[] = []
  for (let y = 0; y < matrix.size; y++) {
    for (let x = 0; x < matrix.size; x++) {
      if (matrix.isDark(x, y)) {
        cells.push(<rect key={`${x}-${y}`} x={x + QR_QUIET_ZONE_MODULES} y={y + QR_QUIET_ZONE_MODULES} width={1} height={1} />)
      }
    }
  }

  return (
    <svg
      viewBox={`0 0 ${total} ${total}`}
      width={size}
      height={size}
      role="img"
      aria-label="Scannable code"
      data-scan-value={value}
      style={{ background: '#fff', borderRadius: 8, shapeRendering: 'crispEdges' }}
    >
      <g fill="#000">{cells}</g>
    </svg>
  )
}
