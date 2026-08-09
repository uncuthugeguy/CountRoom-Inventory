/**
 * Every editable placement on a printed product label. Positions are in
 * printer dots (at `dpi` dots per inch) — CPCL's own coordinate system — so
 * a position here maps 1:1 onto the `x y` pair CPCL's `TEXT`, `BARCODE` and
 * `EG` commands expect.
 *
 * The layout is fully free-form: the logo, name, variation, barcode and SKU
 * text can each be dragged anywhere on the label, including on top of one
 * another or side by side. Nothing here stops two elements overlapping or a
 * position landing past the label's edge — the label editor's live preview
 * is what keeps that visible and fixable, not a constraint in the data.
 */
export interface ElementPosition {
  /** Left edge of the element, in dots from the label's left edge. */
  x: number
  /** Top edge of the element, in dots from the label's top edge. */
  y: number
}

export interface LabelTemplate {
  /** Printable label width, in dots. */
  widthDots: number
  /** Printable label length, in dots — CPCL calls this the "label length". */
  heightDots: number
  /** Printer resolution in dots per inch; used for both axes. */
  dpi: number
  /** CPCL built-in font index (0–7, larger is bigger) for the product name. */
  nameFont: number
  /** CPCL font index for the variation line. */
  variationFont: number
  /** CPCL font index for the human-readable SKU text under the barcode. */
  skuFont: number
  /** Barcode bar height, in dots. */
  barcodeHeight: number
  /** Width of the barcode's narrowest bar, in dots — CPCL's BARCODE command
   * calls this the module width. Every bar is a multiple of it, so this is
   * what actually controls how wide the whole barcode prints; unlike the
   * fixed-index CPCL text fonts, a barcode has no separate "size" step. */
  barcodeModuleWidth: number
  /** The box the logo is scaled to fit inside (preserving its own aspect
   * ratio, letterboxed on white — never stretched/distorted), in dots. This
   * is also the exact size `rasterizeLogo` renders at print time, so what
   * you see in the editor is what prints. */
  logoWidthDots: number
  logoHeightDots: number
  /** Top-left position of the logo bitmap, when a logo is set. */
  logo: ElementPosition
  /** Top-left position of the product name text. */
  name: ElementPosition
  /** Top-left position of the variation text, when a variation is printed. */
  variation: ElementPosition
  /** Top-left position of the barcode. */
  barcode: ElementPosition
  /** Top-left position of the human-readable SKU text. */
  sku: ElementPosition
}

/**
 * A named, saved snapshot of a whole label layout — e.g. "Shipping label"
 * next to "Product label next to "RV" — so switching what you're printing
 * for doesn't mean rebuilding the layout from scratch each time. Only one
 * template is ever "live" (what the canvas edits and what a print uses);
 * saving a preset copies the live template under a name, and loading one
 * copies it back the other way.
 */
export interface LabelPreset {
  id: string
  name: string
  template: LabelTemplate
}

/** Default logo box size, and the sane range it can be resized within — a
 * logo has a genuinely resizable footprint (unlike text, which is stepped
 * font sizes, or a barcode, whose width only makes sense at typical CPCL
 * module-width scales), so this is deliberately generous. */
export const DEFAULT_LOGO_WIDTH_DOTS = 120
export const DEFAULT_LOGO_HEIGHT_DOTS = 60
export const MIN_LOGO_DOTS = 20
export const MAX_LOGO_DOTS = 2000

/** Rough pixel height of CPCL's built-in bitmap fonts 0–7, in dots at 200 dpi.
 * The printer's actual glyphs vary slightly by firmware — this is a guide for
 * the editor's preview and clamping, not an exact match, which is why
 * "Print test label" exists. Shared so the editor and `sanitiseLabelTemplate`
 * agree on what a font size means. */
export const textHeightDots = (font: number): number => 14 + font * 6

/** Rough glyph width for the preview and edge-of-label warnings — not an
 * exact match for the printer's built-in fonts, just enough to flag "this is
 * about to print off the label" while dragging. */
export const approxTextWidthDots = (text: string, fontHeight: number): number => text.length * fontHeight * 0.62

/** A Code 128 barcode's printed width scales directly with CPCL's module
 * width parameter — this is the width of a representative SKU's worth of
 * bars at module width 1, used as a rough "don't let this start off-label"
 * guide since the exact width depends on how many characters are encoded. */
const BARCODE_REPRESENTATIVE_WIDTH_AT_MODULE_1 = 104
export const estimateBarcodeWidthDots = (moduleWidth: number): number =>
  BARCODE_REPRESENTATIVE_WIDTH_AT_MODULE_1 * moduleWidth

/** A 3in x 1.5in label at 203 dpi — the Zebra QLn220's fixed print
 * resolution (it doesn't come in any other DPI; the "220" denotes its 2in
 * print width, not resolution) — with room for a logo beside the name and
 * variation, and the barcode + SKU text beneath. If you're printing to a
 * different printer, change the DPI field in Settings to match its real
 * resolution — every mm/inch you enter is converted to dots using this
 * value, so a wrong DPI here means labels never come out the size you typed
 * no matter how many times you adjust it. */
export const DEFAULT_LABEL_TEMPLATE: LabelTemplate = {
  widthDots: 609,
  heightDots: 305,
  dpi: 203,
  nameFont: 7,
  variationFont: 4,
  skuFont: 4,
  barcodeHeight: 60,
  barcodeModuleWidth: 2,
  logoWidthDots: DEFAULT_LOGO_WIDTH_DOTS,
  logoHeightDots: DEFAULT_LOGO_HEIGHT_DOTS,
  logo: { x: 20, y: 20 },
  name: { x: 160, y: 20 },
  variation: { x: 160, y: 65 },
  barcode: { x: 160, y: 100 },
  sku: { x: 160, y: 180 },
}

/** CPCL's built-in bitmap fonts only go from 0 (smallest) to 7 (largest). */
export const MIN_FONT = 0
export const MAX_FONT = 7

const clampInt = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) return min
  return Math.round(Math.min(max, Math.max(min, value)))
}

/** Clamps a position to stay within the label itself — a stray or stale
 * value (e.g. from before the label was made smaller) can't end up printing
 * off the physical label. */
const clampPosition = (
  pos: Partial<ElementPosition> | undefined,
  fallback: ElementPosition,
  maxX: number,
  maxY: number,
): ElementPosition => ({
  x: clampInt(pos?.x ?? fallback.x, 0, maxX),
  y: clampInt(pos?.y ?? fallback.y, 0, maxY),
})

/**
 * Clamps every field to a sane range so a stray input (negative size, a font
 * index out of CPCL's 0–7 range, a position from off an old/smaller label)
 * can't be saved and silently break every future print. Merges over the
 * defaults first so a partially-saved or older template still produces a
 * complete, valid one.
 */
export function sanitiseLabelTemplate(partial: Partial<LabelTemplate> | undefined): LabelTemplate {
  const merged = { ...DEFAULT_LABEL_TEMPLATE, ...partial }
  const widthDots = clampInt(merged.widthDots, 100, 4000)
  const heightDots = clampInt(merged.heightDots, 100, 4000)
  return {
    widthDots,
    heightDots,
    dpi: clampInt(merged.dpi, 100, 600),
    nameFont: clampInt(merged.nameFont, MIN_FONT, MAX_FONT),
    variationFont: clampInt(merged.variationFont, MIN_FONT, MAX_FONT),
    skuFont: clampInt(merged.skuFont, MIN_FONT, MAX_FONT),
    barcodeHeight: clampInt(merged.barcodeHeight, 10, 1000),
    barcodeModuleWidth: clampInt(merged.barcodeModuleWidth, 1, 10),
    logoWidthDots: clampInt(merged.logoWidthDots, MIN_LOGO_DOTS, MAX_LOGO_DOTS),
    logoHeightDots: clampInt(merged.logoHeightDots, MIN_LOGO_DOTS, MAX_LOGO_DOTS),
    // The logo, name/variation/sku text and barcode all have a real printed
    // footprint, not just a top-left origin — clamping only the origin (as
    // every field used to) let a position sit right at the label's far edge
    // with its actual bulk hanging off it. The browser preview clips that
    // silently; the real printer's EG/TEXT/BARCODE commands don't, and the
    // overrun corrupts everything printed after it. Subtracting each
    // element's known footprint from the max bound keeps the whole element
    // on the label, not just its origin point.
    logo: clampPosition(
      partial?.logo,
      DEFAULT_LABEL_TEMPLATE.logo,
      Math.max(0, widthDots - clampInt(merged.logoWidthDots, MIN_LOGO_DOTS, MAX_LOGO_DOTS)),
      Math.max(0, heightDots - clampInt(merged.logoHeightDots, MIN_LOGO_DOTS, MAX_LOGO_DOTS)),
    ),
    // Text elements' printed width depends on the actual product name/SKU
    // being printed, which isn't known here — only the font's height is a
    // fixed, knowable quantity, so that's all that's safely clampable at
    // save time. Horizontal overrun (a long product name) is instead caught
    // live, per-product, by the editor's on-screen warning.
    name: clampPosition(
      partial?.name,
      DEFAULT_LABEL_TEMPLATE.name,
      widthDots,
      Math.max(0, heightDots - textHeightDots(clampInt(merged.nameFont, MIN_FONT, MAX_FONT))),
    ),
    variation: clampPosition(
      partial?.variation,
      DEFAULT_LABEL_TEMPLATE.variation,
      widthDots,
      Math.max(0, heightDots - textHeightDots(clampInt(merged.variationFont, MIN_FONT, MAX_FONT))),
    ),
    barcode: clampPosition(
      partial?.barcode,
      DEFAULT_LABEL_TEMPLATE.barcode,
      Math.max(0, widthDots - estimateBarcodeWidthDots(clampInt(merged.barcodeModuleWidth, 1, 10))),
      Math.max(0, heightDots - clampInt(merged.barcodeHeight, 10, 1000)),
    ),
    sku: clampPosition(
      partial?.sku,
      DEFAULT_LABEL_TEMPLATE.sku,
      widthDots,
      Math.max(0, heightDots - textHeightDots(clampInt(merged.skuFont, MIN_FONT, MAX_FONT))),
    ),
  }
}
