import { LABEL_SIZES, type LabelSize } from './labelMedia'
import { DEFAULT_CALIBRATION, type LabelRotation, type PrinterCalibration } from './labelRaster'

/**
 * How *this device* talks to its Polono — kept on the device, not synced to
 * the account, because it depends on which computer/driver is printing.
 */
export interface LabelPrinterSettings {
  /** Desktop app only: system printer to print to silently. Unset = show the print dialog. */
  printerName?: string
  /** Per label size: nudge and rotation to line the print up with the label. */
  calibration: Record<LabelSize, PrinterCalibration>
}

export const MAX_OFFSET_DOTS = 100

export const DEFAULT_LABEL_PRINTER_SETTINGS: LabelPrinterSettings = {
  calibration: { '2x1': { ...DEFAULT_CALIBRATION }, '4x6': { ...DEFAULT_CALIBRATION } },
}

const ROTATIONS: LabelRotation[] = [0, 90, 180, 270]

const offset = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.round(Math.min(MAX_OFFSET_DOTS, Math.max(-MAX_OFFSET_DOTS, value)))
    : 0

export function sanitiseCalibration(raw: unknown): PrinterCalibration {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<PrinterCalibration>
  return {
    offsetX: offset(r.offsetX),
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
  return { ...(printerName ? { printerName } : {}), calibration }
}
