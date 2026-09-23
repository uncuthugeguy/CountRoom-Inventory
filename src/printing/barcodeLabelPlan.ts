import { encodeCode128 } from './code128Render'
import {
  MIN_FONT_DOTS,
  TEXT_ELEMENT_KEYS,
  type BarcodeLabelLayout,
  type LabelElementKey,
  type TextAlign,
  type TextElementKey,
} from './barcodeLabelLayout'
import { LABEL_MEDIA } from './labelMedia'

/**
 * Turns a layout plus one product into an exact list of things to draw, in
 * printer dots. Kept free of any canvas/DOM code (text width comes in as a
 * `measure` function) so the fitting rules — the part that decides whether a
 * label is readable and scannable — are unit-testable.
 */

/** A plain, heavy sans that the Polono's 203 dpi head reproduces cleanly. */
export const LABEL_FONT_FAMILY = 'Arial, "Helvetica Neue", Helvetica, sans-serif'

export const labelFont = (px: number, bold: boolean): string => `${bold ? 700 : 400} ${px}px ${LABEL_FONT_FAMILY}`

export interface LabelContent {
  name: string
  sku: string
  variation?: string
  price?: number
}

export type MeasureText = (text: string, fontPx: number, bold: boolean) => number

export interface TextOp {
  kind: 'text'
  key: TextElementKey
  text: string
  /** Anchor x — left edge, centre or right edge depending on `align`. */
  x: number
  /** Alphabetic baseline. */
  y: number
  fontPx: number
  bold: boolean
  align: TextAlign
}

export interface BarsOp {
  kind: 'bars'
  /** Each dark run as [x, width] in dots. */
  runs: [number, number][]
  y: number
  h: number
  moduleWidth: number
}

export interface LogoOp {
  kind: 'logo'
  x: number
  y: number
  w: number
  h: number
}

export type LabelOp = TextOp | BarsOp | LogoOp

export interface LabelWarning {
  key: LabelElementKey
  message: string
}

export interface LabelPlan {
  width: number
  height: number
  ops: LabelOp[]
  warnings: LabelWarning[]
}

const TRUNCATION_MARK = '…'
/** Largest bar width used — past this a barcode just gets wider, not easier to scan. */
const MAX_MODULE_WIDTH = 4
/** Code 128 asks for ~10 modules of blank either side; scanners cope with a
 * bit less, so the bar width is only stepped down below this. */
const MIN_QUIET_MODULES = 6

export const formatLabelPrice = (price: number | undefined): string =>
  typeof price === 'number' && Number.isFinite(price) && price > 0 ? `£${price.toFixed(2)}` : ''

function textFor(key: TextElementKey, content: LabelContent): string {
  switch (key) {
    case 'name':
      return content.name.trim()
    case 'variation':
      return (content.variation ?? '').trim()
    case 'sku':
      return content.sku.trim()
    case 'price':
      return formatLabelPrice(content.price)
  }
}

/**
 * Fits `text` into a box: tries the element's own size first, shrinks down
 * to 60% of it, and only then cuts the end off with an ellipsis.
 */
export function fitText(
  text: string,
  boxW: number,
  boxH: number,
  fontSize: number,
  bold: boolean,
  measure: MeasureText,
): { text: string; fontPx: number; shortened: boolean } {
  const maxPx = Math.max(MIN_FONT_DOTS, Math.min(fontSize, Math.floor(boxH * 0.95)))
  const minPx = Math.max(MIN_FONT_DOTS, Math.floor(maxPx * 0.6))
  for (let px = maxPx; px >= minPx; px--) {
    if (measure(text, px, bold) <= boxW) return { text, fontPx: px, shortened: false }
  }
  for (let len = text.length - 1; len > 0; len--) {
    const candidate = text.slice(0, len).trimEnd() + TRUNCATION_MARK
    if (measure(candidate, minPx, bold) <= boxW) return { text: candidate, fontPx: minPx, shortened: true }
  }
  return { text: TRUNCATION_MARK, fontPx: minPx, shortened: true }
}

export function planBarcodeLabel(
  layout: BarcodeLabelLayout,
  content: LabelContent,
  measure: MeasureText,
  options: { hasLogo: boolean },
): LabelPlan {
  const { widthDots: width, heightDots: height } = LABEL_MEDIA['2x1']
  const ops: LabelOp[] = []
  const warnings: LabelWarning[] = []

  if (layout.logo.visible && options.hasLogo) {
    const { x, y, w, h } = layout.logo
    ops.push({ kind: 'logo', x, y, w, h })
  }

  for (const key of TEXT_ELEMENT_KEYS) {
    const el = layout[key]
    if (!el.visible) continue
    const raw = textFor(key, content)
    if (!raw) continue
    const fitted = fitText(raw, el.w, el.h, el.fontSize, el.bold, measure)
    if (fitted.shortened) warnings.push({ key, message: `${raw} is too long for its box and has been shortened.` })
    const x = el.align === 'left' ? el.x : el.align === 'right' ? el.x + el.w : el.x + el.w / 2
    // Centre the letters vertically in the box: cap height is ~0.72em for
    // Arial, so the baseline sits that much below the box's middle-minus-half.
    const y = Math.round(el.y + el.h / 2 + fitted.fontPx * 0.36)
    ops.push({ kind: 'text', key, text: fitted.text, x: Math.round(x), y, fontPx: fitted.fontPx, bold: el.bold, align: el.align })
  }

  const bc = layout.barcode
  const sku = content.sku.trim()
  if (bc.visible && sku) {
    const bars = encodeCode128(sku)
    if (!bars) {
      warnings.push({ key: 'barcode', message: `The SKU "${sku}" has characters a barcode can't hold.` })
    } else {
      let m = Math.min(MAX_MODULE_WIDTH, Math.floor(bc.w / bars.width))
      if (m < 1) {
        m = 1
        warnings.push({ key: 'barcode', message: 'The SKU is too long for the barcode box — make the box wider.' })
      }
      const startFor = (mod: number) => Math.round(bc.x + (bc.w - bars.width * mod) / 2)
      const quietFor = (mod: number) => Math.min(startFor(mod), width - (startFor(mod) + bars.width * mod))
      while (m > 1 && quietFor(m) < MIN_QUIET_MODULES * m) m--
      const startX = startFor(m)
      const runs: [number, number][] = []
      let i = 0
      while (i < bars.width) {
        if (!bars.isDark(i)) {
          i++
          continue
        }
        let j = i
        while (j < bars.width && bars.isDark(j)) j++
        runs.push([startX + i * m, (j - i) * m])
        i = j
      }
      ops.push({ kind: 'bars', runs, y: bc.y, h: bc.h, moduleWidth: m })
    }
  }

  return { width, height, ops, warnings }
}
