/**
 * The two label stocks CountRoom prints on, both on the Polono direct
 * thermal printer.
 *
 * Everything label-related works in printer dots at the Polono's real
 * 203 dpi — not screen pixels, not CSS inches — so a layout is drawn onto a
 * bitmap that is exactly one pixel per printhead dot. That bitmap is then
 * handed to the print system at the label's true physical size, so the
 * driver never has to rescale anything (rescaling is what made fine text and
 * barcodes print blurry or at half size before).
 */

/** The Polono's printhead resolution. Fixed — not a user setting. */
export const POLONO_DPI = 203

export type LabelSize = '2x1' | '4x6'

export interface LabelMedia {
  size: LabelSize
  /** Human name shown in the UI. */
  label: string
  widthIn: number
  heightIn: number
  widthDots: number
  heightDots: number
}

const media = (size: LabelSize, label: string, widthIn: number, heightIn: number): LabelMedia => ({
  size,
  label,
  widthIn,
  heightIn,
  widthDots: Math.round(widthIn * POLONO_DPI),
  heightDots: Math.round(heightIn * POLONO_DPI),
})

export const LABEL_MEDIA: Record<LabelSize, LabelMedia> = {
  '2x1': media('2x1', '2 × 1 in barcode label', 2, 1),
  '4x6': media('4x6', '4 × 6 in shipping label', 4, 6),
}

export const LABEL_SIZES: LabelSize[] = ['2x1', '4x6']

export const dotsToMm = (dots: number): number => (dots / POLONO_DPI) * 25.4
export const mmToDots = (mm: number): number => Math.round((mm / 25.4) * POLONO_DPI)
/** Text size is shown to people in points but stored in dots. */
export const dotsToPt = (dots: number): number => (dots / POLONO_DPI) * 72
export const ptToDots = (pt: number): number => Math.round((pt / 72) * POLONO_DPI)
