import { LABEL_SIZES, POLONO_DPI, type LabelSize } from './labelMedia'
import { DEFAULT_CALIBRATION, type LabelRotation, type PrinterCalibration } from './labelRaster'

/**
 * How *this device* talks to its Polono — kept on the device, not synced to
 * the account, because it depends on which computer/driver is printing.
 */
export interface LabelPrinterSettings {
  /** Desktop app only: system printer to print to silently. Unset = show the print dialog. */
  printerName?: string
  /** Width of the printhead, in inches — every page is sent this wide. */
  headWidthIn: number
  /** Per label size: where the roll sits under the head, nudge and rotation. */
  calibration: Record<LabelSize, PrinterCalibration>
}

/** Offered in Printer setup. The Polono PL60/PL80E/PL420 family take labels up to 4.25 in wide. */
export const HEAD_WIDTH_CHOICES: { value: number; label: string }[] = [
  { value: 4, label: '4 in (104 mm) — Polono PL60 / PL80E / PL420' },
  { value: 4.25, label: '4.25 in (108 mm)' },
  { value: 3, label: '3 in (80 mm)' },
  { value: 2, label: '2 in — label width only' },
]
export const DEFAULT_HEAD_WIDTH_IN = 4
export const MAX_OFFSET_DOTS = 100

export const headWidthDots = (printer: LabelPrinterSettings): number => Math.round(printer.headWidthIn * POLONO_DPI)

export const DEFAULT_LABEL_PRINTER_SETTINGS: LabelPrinterSettings = {
  headWidthIn: DEFAULT_HEAD_WIDTH_IN,
  calibration: { '2x1': { ...DEFAULT_CALIBRATION }, '4x6': { ...DEFAULT_CALIBRATION } },
}

const ROTATIONS: LabelRotation[] = [0, 90, 180, 270]

const offset = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.round(Math.min(MAX_OFFSET_DOTS, Math.max(-MAX_OFFSET_DOTS, value)))
    : 0

export function sanitiseCalibration(raw: unknown): PrinterCalibration {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<PrinterCalibration>
  const left = r.leftDots
  return {
    leftDots:
      typeof left === 'number' && Number.isFinite(left) ? Math.round(Math.min(1000, Math.max(0, left))) : null,
    offsetY: offset(r.offsetY),
    rotation: ROTATIONS.includes(r.rotation as LabelRotation) ? (r.rotation as LabelRotation) : 0,
  }
}

export function sanitiseLabelPrinterSettings(raw: unknown): LabelPrinterSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<LabelPrinterSettings>
  const cal = (r.calibration && typeof r.calibration === 'object' ? r.calibration : {}) as Partial<
    Record<LabelSize, unknown>
  >
  const calibration = Object.fromEntries(LABEL_SIZES.map((size) => [size, sanitiseCalibration(cal[size])])) as Record<
    LabelSize,
    PrinterCalibration
  >
  const printerName = typeof r.printerName === 'string' && r.printerName.trim() ? r.printerName.trim() : undefined
  const head = r.headWidthIn
  const headWidthIn =
    typeof head === 'number' && Number.isFinite(head) ? Math.min(4.5, Math.max(1, head)) : DEFAULT_HEAD_WIDTH_IN
  return { ...(printerName ? { printerName } : {}), headWidthIn, calibration }
}
