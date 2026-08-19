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

/**
 * Which of the five label elements actually print — unticking one leaves its
 * position, size and font untouched (so re-ticking it later restores exactly
 * where it was) but drops it from both the live preview and the real CPCL
 * output. Lets a business turn off e.g. the logo for a small label roll
 * without losing the uploaded image or its placement, in case a bigger label
 * or a different printer later has room for it.
 */
export interface LabelElementVisibility {
  name: boolean
  variation: boolean
  barcode: boolean
  sku: boolean
  logo: boolean
}

/** Every element prints by default — matches the app's behaviour before this
 * setting existed, so an older saved template with no `include` field at all
 * still prints exactly as it always did. */
export const DEFAULT_LABEL_ELEMENT_VISIBILITY: LabelElementVisibility = {
  name: true,
  variation: true,
  barcode: true,
  sku: true,
  logo: true,
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
  /** Printer darkness ("print.tone" in Zebra's SGD command set), sent as
   * `! U1 setvar "print.tone" "<value>"` before every label. Zebra's
   * documented range is 0–30 (default 4 on most printers). Larger CPCL
   * bitmap fonts (like the default name font) have thinner relative stroke
   * width than a barcode's solid bars, so they're the first thing to look
   * faint if this is too low — raise it if text (especially the product
   * name) is printing lighter than the barcode next to it. */
  darkness: number
  /** Print speed in inches per second ("media.speed" in Zebra's SGD command
   * set), sent as `! U1 setvar "media.speed" "<value>"` before every label.
   * Zebra's documented range is 2–12 ips. Slower gives the print head more
   * dwell time per dot, which — together with `darkness` — is usually what
   * fixes fine text printing lighter than thicker elements like a barcode. */
  printSpeedIps: number
  /** Which elements are actually turned on for this label — see
   * `LabelElementVisibility`. */
  include: LabelElementVisibility
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

/** The character used to show "there's more, and it's been cut off" — one
 * glyph, unlike three periods, so it costs the least of the shrinking
 * budget in `truncateToFitDots` below. */
const TRUNCATION_MARK = '…'

/**
 * Shortens `text` from the end — just enough to fit `maxWidthDots` at
 * `fontHeightDots`, appending `TRUNCATION_MARK` when it actually had to cut
 * anything — using the same `approxTextWidthDots` estimate the editor's own
 * overflow warning is built on (see that function's doc comment for why
 * it's an estimate, not an exact glyph measurement: a real product name is
 * trimmed to *roughly* what fits, with a character or two of slack either
 * way, not a pixel-exact cut).
 *
 * Used at print time for the name, variation and human-readable SKU text
 * elements (`printing/cpcl.ts`, `printing/browserLabelPrint.ts`) and by the
 * Settings › Label template editor's own live preview, so a product name
 * that's genuinely too long for the label it's printing to gets shortened
 * automatically instead of running off the physical label or needing a
 * manual per-product fix. Deliberately NOT used for the barcode's own
 * encoded value (`cleanSku` in `cpcl.ts`, the SKU passed to
 * `encodeCode128` in `browserLabelPrint.ts`) — cutting that down would
 * print a barcode that scans back to the wrong, truncated SKU, which is
 * far worse than a barcode running past the label edge (already flagged by
 * its own separate warning, since a barcode can't be auto-shrunk the way
 * text can — only its module width or the label layout can fix that).
 * `maxWidthDots <= 0` (e.g. the element's own position already sits at or
 * past the label's edge) returns '' rather than looping forever or
 * printing at a negative offset.
 */
export function truncateToFitDots(text: string, maxWidthDots: number, fontHeightDots: number): string {
  if (maxWidthDots <= 0) return ''
  if (approxTextWidthDots(text, fontHeightDots) <= maxWidthDots) return text
  for (let len = text.length - 1; len > 0; len--) {
    const candidate = text.slice(0, len) + TRUNCATION_MARK
    if (approxTextWidthDots(candidate, fontHeightDots) <= maxWidthDots) return candidate
  }
  return TRUNCATION_MARK
}

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
  // Darker and slower than the printer's own factory default (tone 4,
  // speed varies by model) — chosen so large/fine text like the name
  // (font 7 by default) comes out fully solid, not just the barcode.
  darkness: 14,
  printSpeedIps: 2,
  include: { ...DEFAULT_LABEL_ELEMENT_VISIBILITY },
}

/** Which physical printer a label prints to — see `printing/printLabel.ts`
 * for how this branches the actual print path (raw CPCL over the network
 * for the Zebra, a browser print dialog for the Polono). Kept as a
 * device-local `Settings` field (not synced via `AccountSettingsSync`, the
 * way the label template/logo/channels are) since it describes which
 * printer is physically wired to *this* machine, not something that should
 * follow the business account to a different device. */
export type PrinterKind = 'zebra' | 'polono'

export const PRINTER_LABELS: Record<PrinterKind, string> = {
  zebra: 'Zebra QLn220',
  polono: 'Polono PL80E',
}

/** A 2in x 1in label at 203 dpi — the Polono PL80E's native resolution.
 * Unlike the Zebra, the Polono prints through the OS's normal print dialog
 * rather than raw commands (see `printing/browserLabelPrint.ts`), but it
 * shares the same `LabelTemplate` shape and editor so positions/fonts/sizes
 * all work the same way. Smaller label than the Zebra's default, so the
 * logo and variation line start switched off to keep the name, barcode and
 * SKU legible — turn them back on (Settings › Label template) if your
 * labels have room.
 *
 * Positions/sizes below are deliberately generous relative to the 406x203
 * dot canvas: a real physical test print (2026-08-19) showed the previous,
 * more conservative defaults (module width 2, barcode height 70, sku font
 * 3, tight top-left positions) only used roughly the left half and top
 * two-thirds of the actual label, leaving a large unused strip on the
 * right and along the bottom — the label itself was the right physical
 * size, the *content* just wasn't sized to fill it. These values push the
 * barcode wider and taller and the SKU text bigger, and space every
 * on-by-default element (name/barcode/sku) down the label with only a
 * small margin, so a fresh Polono setup — or a "Reset to defaults" — fills
 * the label edge-to-edge for a typical short product name/SKU.
 *
 * `nameFont` is deliberately smaller here (2, not the 4 a first pass at this
 * left it at) — font 4 was already too big for this label's width on its
 * own, independent of the width/height-filling pass above: at font 4, the
 * editor's own bundled preview name ("Sample Product Name", 20 characters —
 * see `SAMPLE_PRODUCT` in `LabelTemplateEditor.tsx`) is about 472 dots wide
 * by `approxTextWidthDots`'s estimate, comfortably wider than the whole
 * 406-dot-wide label — so the "Name runs past the edge of the label"
 * warning fired on the *default* template's *own* sample data, before a
 * real product was ever involved. Font 2 keeps a 20-character name under
 * ~340 dots (with the 15-dot left margin), leaving real headroom instead of
 * sitting right at the edge. A genuinely long real product name can still
 * overflow at any font size — that's what the live warning is for — but the
 * out-of-the-box default shouldn't warn against its own sample text.
 * Barcode and SKU stay large (module width 3, sku font 4) since neither of
 * those overflows at this width; only the name needed to come down.
 *
 * `barcodeHeight` and the `barcode`/`sku` y-positions went through one more
 * pass after a physical test print of the above still showed a clear band
 * of unused label below the SKU text — the first widening pass fixed the
 * *width* but was still leaving roughly a fifth of the *height* (name/
 * barcode/sku plus their gaps only reached to dot 178 of 203) sitting
 * blank at the bottom. `barcodeHeight` doesn't affect a barcode's *width*
 * at all (only `barcodeModuleWidth` does — see that field's doc comment),
 * so it was free to grow a lot further without reopening the width-overrun
 * problem `nameFont` above was fixed for: 90 → 118 dots, with the gaps
 * between name/barcode/sku trimmed to a snug 4 dots each and the SKU text
 * pushed down to sit just 5 dots off the bottom edge instead of 25. Name
 * stays where it was — its height is tied to `nameFont`, which stays small
 * on purpose (see above) — so the barcode is what grows to fill the
 * reclaimed space. End result: name(8–34) + gap + barcode(38–156) + gap +
 * sku(160–198) uses 198 of the label's 203 dots, not 178 — under 3% left
 * over, down from about 12%. */
export const DEFAULT_POLONO_LABEL_TEMPLATE: LabelTemplate = {
  widthDots: 406,
  heightDots: 203,
  dpi: 203,
  nameFont: 2,
  variationFont: 2,
  skuFont: 4,
  barcodeHeight: 118,
  barcodeModuleWidth: 3,
  logoWidthDots: 60,
  logoHeightDots: 40,
  logo: { x: 330, y: 8 },
  name: { x: 15, y: 8 },
  variation: { x: 15, y: 36 },
  barcode: { x: 15, y: 38 },
  sku: { x: 15, y: 160 },
  darkness: 14,
  printSpeedIps: 2,
  include: { ...DEFAULT_LABEL_ELEMENT_VISIBILITY, variation: false, logo: false },
}

/** CPCL's built-in bitmap fonts only go from 0 (smallest) to 7 (largest) —
 * the Polono path (see `browserLabelPrint.ts`) reuses the same 0–7 scale via
 * `textHeightDots` purely as a font-size unit, since it isn't limited to
 * CPCL's built-in bitmap fonts the way the Zebra is. */
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

/** Coerces a possibly-partial, possibly-missing visibility object (an older
 * saved template predates this field entirely) into a complete one, one key
 * at a time — so a template saved with only `{ logo: false }` still shows
 * every other element rather than hiding them too. */
const sanitiseVisibility = (partial: Partial<LabelElementVisibility> | undefined): LabelElementVisibility => ({
  name: partial?.name ?? true,
  variation: partial?.variation ?? true,
  barcode: partial?.barcode ?? true,
  sku: partial?.sku ?? true,
  logo: partial?.logo ?? true,
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
    darkness: clampInt(merged.darkness, 0, 30),
    printSpeedIps: clampInt(merged.printSpeedIps, 2, 12),
    include: sanitiseVisibility(merged.include),
  }
}

/**
 * Same clamping as `sanitiseLabelTemplate`, but falls back to the Polono's
 * own defaults (`DEFAULT_POLONO_LABEL_TEMPLATE`) for any missing field
 * instead of the Zebra's — otherwise a partially-saved Polono template (or
 * one from before this field existed at all) would silently pick up the
 * Zebra's 609x305 dimensions and off-label positions. Delegates to
 * `sanitiseLabelTemplate` for the actual clamping once every field is
 * filled in from the right defaults, so both printers share one set of
 * range/overrun rules.
 */
export function sanitisePolonoLabelTemplate(partial: Partial<LabelTemplate> | undefined): LabelTemplate {
  return sanitiseLabelTemplate({ ...DEFAULT_POLONO_LABEL_TEMPLATE, ...partial })
}
