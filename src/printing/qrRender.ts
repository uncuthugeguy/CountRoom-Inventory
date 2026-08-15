import { BarcodeFormat, EncodeHintType, QRCodeWriter } from '@zxing/library'

/**
 * A decoded QR matrix, exposed as a simple square grid rather than the
 * library's own `BitMatrix` type — callers (the on-screen scan view) only
 * ever need "how big is it" and "is this cell dark", not the rest of
 * zxing's API surface.
 */
export interface QrMatrix {
  /** Width and height in modules (the matrix is always square for a QR code). */
  size: number
  isDark(x: number, y: number): boolean
}

/**
 * Renders `value` as a QR code module grid, ready to draw as an SVG (see
 * `ScanCode`). Returns `null` for anything that can't be encoded — an empty
 * value, or (rarely) content too long for a QR code to hold — so the caller
 * can show a fallback instead of crashing.
 *
 * Requesting a 1x1 output size with no margin (handled separately by the
 * caller, as a quiet zone in the SVG itself) gets back the QR's natural,
 * unscaled module grid — one matrix cell per module, which is what a
 * caller drawing its own `<rect>` per module wants.
 */
export function encodeQr(value: string): QrMatrix | null {
  if (!value.trim()) return null
  try {
    const writer = new QRCodeWriter()
    const hints = new Map<EncodeHintType, unknown>([
      [EncodeHintType.MARGIN, 0],
      [EncodeHintType.ERROR_CORRECTION, 'M'],
    ])
    const bitMatrix = writer.encode(value, BarcodeFormat.QR_CODE, 1, 1, hints)
    const size = bitMatrix.getWidth()
    return { size, isDark: (x, y) => bitMatrix.get(x, y) }
  } catch {
    return null
  }
}
