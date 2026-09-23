import { LABEL_MEDIA } from './labelMedia'

/**
 * The 2 × 1 in product/barcode label layout.
 *
 * Every element is a box (x, y, width, height) in printer dots on the
 * 406 × 203 dot label. The box is the whole contract: text is shrunk to fit
 * its box, the barcode picks the widest crisp bar width that fits its box,
 * the logo is scaled to fit its box. So what you see in the editor is always
 * what prints — there are no hidden "estimated widths" to drift out of sync.
 */

export type TextElementKey = 'name' | 'variation' | 'sku' | 'price'
export type LabelElementKey = TextElementKey | 'barcode' | 'logo'

export const LABEL_ELEMENT_KEYS: LabelElementKey[] = ['name', 'variation', 'sku', 'price', 'barcode', 'logo']
export const TEXT_ELEMENT_KEYS: TextElementKey[] = ['name', 'variation', 'sku', 'price']

export const LABEL_ELEMENT_NAMES: Record<LabelElementKey, string> = {
  name: 'Product name',
  variation: 'Variation',
  sku: 'SKU text',
  price: 'Price',
  barcode: 'Barcode',
  logo: 'Logo',
}

export interface LabelBox {
  x: number
  y: number
  w: number
  h: number
}

export type TextAlign = 'left' | 'center' | 'right'

export interface TextElement extends LabelBox {
  visible: boolean
  /** Largest text size to use, in dots. Long text shrinks below this to fit. */
  fontSize: number
  bold: boolean
  align: TextAlign
}

export interface BoxElement extends LabelBox {
  visible: boolean
}

export interface BarcodeLabelLayout {
  /** Distinguishes this format from the old Zebra-era `LabelTemplate` that
   * may still be sitting in the account's synced settings. */
  version: 2
  name: TextElement
  variation: TextElement
  sku: TextElement
  price: TextElement
  barcode: BoxElement
  logo: BoxElement
}

const W = LABEL_MEDIA['2x1'].widthDots // 406
const H = LABEL_MEDIA['2x1'].heightDots // 203

/** Minimum element size, in dots (~1.3 mm). */
export const MIN_BOX_DOTS = 10
export const MIN_FONT_DOTS = 10
export const MAX_FONT_DOTS = 120

/**
 * Name across the top, a big barcode, SKU underneath, then variation and
 * price sharing the bottom line. ~2 mm side margins so nothing lands on the
 * very edge of the roll, where direct thermal labels print least reliably.
 */
export const DEFAULT_BARCODE_LABEL_LAYOUT: BarcodeLabelLayout = {
  version: 2,
  name: { x: 14, y: 6, w: W - 28, h: 36, visible: true, fontSize: 30, bold: true, align: 'center' },
  barcode: { x: 14, y: 44, w: W - 28, h: 94, visible: true },
  sku: { x: 14, y: 140, w: W - 28, h: 30, visible: true, fontSize: 26, bold: true, align: 'center' },
  variation: { x: 14, y: 172, w: 250, h: 26, visible: true, fontSize: 22, bold: false, align: 'left' },
  price: { x: 268, y: 172, w: W - 14 - 268, h: 26, visible: false, fontSize: 24, bold: true, align: 'right' },
  logo: { x: 14, y: 6, w: 70, h: 36, visible: false },
}

const num = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

/** Keeps a box fully on the label and at least `MIN_BOX_DOTS` in each direction. */
export function clampBox(box: LabelBox): LabelBox {
  const w = clamp(box.w, MIN_BOX_DOTS, W)
  const h = clamp(box.h, MIN_BOX_DOTS, H)
  return { x: clamp(box.x, 0, W - w), y: clamp(box.y, 0, H - h), w, h }
}

function sanitiseBox(raw: unknown, fallback: BoxElement): BoxElement {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<BoxElement>
  return {
    ...clampBox({ x: num(r.x, fallback.x), y: num(r.y, fallback.y), w: num(r.w, fallback.w), h: num(r.h, fallback.h) }),
    visible: typeof r.visible === 'boolean' ? r.visible : fallback.visible,
  }
}

function sanitiseText(raw: unknown, fallback: TextElement): TextElement {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<TextElement>
  const box = sanitiseBox(raw, fallback)
  return {
    ...box,
    fontSize: clamp(num(r.fontSize, fallback.fontSize), MIN_FONT_DOTS, MAX_FONT_DOTS),
    bold: typeof r.bold === 'boolean' ? r.bold : fallback.bold,
    align: r.align === 'left' || r.align === 'center' || r.align === 'right' ? r.align : fallback.align,
  }
}

/**
 * Turns anything (a saved layout, a synced one from another device, junk)
 * into a valid layout. Anything that isn't a version-2 layout — including
 * the old Zebra/CPCL `LabelTemplate` — is ignored and the default is used,
 * since the old dot positions don't mean anything in the new box model.
 */
export function sanitiseBarcodeLabelLayout(raw: unknown): BarcodeLabelLayout {
  if (!raw || typeof raw !== 'object' || (raw as { version?: unknown }).version !== 2) {
    return structuredCloneLayout(DEFAULT_BARCODE_LABEL_LAYOUT)
  }
  const r = raw as Partial<Record<LabelElementKey, unknown>>
  const d = DEFAULT_BARCODE_LABEL_LAYOUT
  return {
    version: 2,
    name: sanitiseText(r.name, d.name),
    variation: sanitiseText(r.variation, d.variation),
    sku: sanitiseText(r.sku, d.sku),
    price: sanitiseText(r.price, d.price),
    barcode: sanitiseBox(r.barcode, d.barcode),
    logo: sanitiseBox(r.logo, d.logo),
  }
}

export const isBarcodeLabelLayout = (raw: unknown): boolean =>
  !!raw && typeof raw === 'object' && (raw as { version?: unknown }).version === 2

function structuredCloneLayout(layout: BarcodeLabelLayout): BarcodeLabelLayout {
  return JSON.parse(JSON.stringify(layout)) as BarcodeLabelLayout
}

export const isTextElementKey = (key: LabelElementKey): key is TextElementKey =>
  (TEXT_ELEMENT_KEYS as string[]).includes(key)
