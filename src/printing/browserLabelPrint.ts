import type { Result } from '../domain/types'
import { encodeCode128 } from './code128Render'
import {
  textFamilyFor,
  textSizeDotsFor,
  truncateToFitDots,
  type LabelTemplate,
  type PolonoPrintRotation,
} from './labelTemplate'

/** Minimal shape this module needs from a product — kept narrow so the
 * "print test label" sample product in the label editor doesn't need to be
 * a full `Product`. */
export interface PrintableLabel {
  name: string
  sku: string
  variation?: string
}

const escapeXml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * Renders `value` as a real, scannable Code 128 bar pattern (unlike the
 * Zebra path, where the printer's own CPCL firmware does the Code 128
 * encoding — the browser print path has no such firmware to lean on, so
 * `encodeCode128` does it client-side). Bars start exactly at (x, y) with no
 * extra quiet-zone padding added — matching how the Settings > Label
 * template editor's live preview already treats `barcode.x`/`barcode.y` as
 * the position of the bars themselves, so what's dragged into place there is
 * exactly what prints. Returns '' (prints nothing) for a SKU Code 128 can't
 * encode — e.g. one containing a character outside printable ASCII — rather
 * than failing the whole label; the SKU text element (if enabled) still
 * shows it as text.
 */
function barcodeSvg(value: string, x: number, y: number, heightDots: number, moduleWidth: number): string {
  const bars = encodeCode128(value)
  if (!bars) return ''
  const rects: string[] = []
  for (let i = 0; i < bars.width; i++) {
    if (!bars.isDark(i)) continue
    rects.push(`<rect x="${x + i * moduleWidth}" y="${y}" width="${moduleWidth}" height="${heightDots}" fill="#000"/>`)
  }
  return rects.join('')
}

/**
 * Builds the actual drawable content (background rect, logo, text, barcode)
 * as a bare string of SVG elements — not wrapped in its own `<svg>` tag,
 * since that wrapping differs between the normal (unrotated) output
 * (`buildLabelSvg`) and the pre-rotated one (`buildRotatedLabelSvg`) used
 * when `PolonoPrintRotation` is turned on, but the content itself is
 * identical either way. Font size and family for the name/variation/SKU
 * text go through `textSizeDotsFor`/`textFamilyFor` with `polono: true` —
 * the Polono's own continuous size/family, not the Zebra's stepped
 * CPCL-font-index approximation (see those functions' doc comments in
 * `labelTemplate.ts`).
 */
function buildLabelParts(product: PrintableLabel, template: LabelTemplate, logoDataUrl: string | undefined): string {
  const t = template
  const parts: string[] = []

  if (t.include.logo && logoDataUrl) {
    parts.push(
      `<image href="${escapeXml(logoDataUrl)}" x="${t.logo.x}" y="${t.logo.y}" width="${t.logoWidthDots}" height="${t.logoHeightDots}" preserveAspectRatio="xMidYMid meet"/>`,
    )
  }

  // Text elements (unlike the barcode below) are shortened to fit whatever
  // horizontal room they have left on the label — see `truncateToFitDots`'s
  // doc comment for why this is safe for these three but never for the
  // barcode's own encoded value.
  if (t.include.name && product.name) {
    const nameSize = textSizeDotsFor(t, 'name', true)
    const nameFamily = textFamilyFor(t, 'name', true)
    const fitted = truncateToFitDots(product.name, t.widthDots - t.name.x, nameSize)
    parts.push(
      `<text x="${t.name.x}" y="${t.name.y + nameSize}" font-size="${nameSize}" font-family="${escapeXml(nameFamily)}" fill="#000">${escapeXml(fitted)}</text>`,
    )
  }

  if (t.include.variation && product.variation) {
    const variationSize = textSizeDotsFor(t, 'variation', true)
    const variationFamily = textFamilyFor(t, 'variation', true)
    const fitted = truncateToFitDots(`Variation: ${product.variation}`, t.widthDots - t.variation.x, variationSize)
    parts.push(
      `<text x="${t.variation.x}" y="${t.variation.y + variationSize}" font-size="${variationSize}" font-family="${escapeXml(variationFamily)}" fill="#000">${escapeXml(fitted)}</text>`,
    )
  }

  if (t.include.barcode && product.sku) {
    parts.push(barcodeSvg(product.sku, t.barcode.x, t.barcode.y, t.barcodeHeight, t.barcodeModuleWidth))
  }

  if (t.include.sku && product.sku) {
    const skuSize = textSizeDotsFor(t, 'sku', true)
    const skuFamily = textFamilyFor(t, 'sku', true)
    const fitted = truncateToFitDots(product.sku, t.widthDots - t.sku.x, skuSize)
    parts.push(
      `<text x="${t.sku.x}" y="${t.sku.y + skuSize}" font-size="${skuSize}" font-family="${escapeXml(skuFamily)}" fill="#000">${escapeXml(fitted)}</text>`,
    )
  }

  return parts.join('')
}

/**
 * Builds the label as a standalone SVG string, sized to the template's real
 * physical dimensions (`widthDots/dpi` inches square, so it prints at true
 * size regardless of screen DPI) and using the exact same coordinate
 * convention — position is the element's top-left corner, in dots — as the
 * Settings > Label template live preview (`LabelTemplateEditor`'s
 * `LabelCanvas`), so a layout edited there prints exactly where it was
 * placed. No monochrome/bitmap conversion is needed for the logo the way
 * the Zebra's CPCL path needs (`bitmap.ts`/`logoRaster.ts`) — the browser's
 * own print pipeline and the Polono's driver handle color-to-thermal
 * conversion.
 *
 * This is the label in its natural, unrotated orientation — always what the
 * editor's own preview shows, and what actually prints when
 * `PolonoPrintRotation` is `'off'`. See `buildRotatedLabelSvg` for the
 * pre-rotated variant used by the other two rotation settings.
 */
export function buildLabelSvg(product: PrintableLabel, template: LabelTemplate, logoDataUrl: string | undefined): string {
  const t = template
  const widthIn = t.widthDots / t.dpi
  const heightIn = t.heightDots / t.dpi
  const inner = buildLabelParts(product, template, logoDataUrl)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${widthIn}in" height="${heightIn}in" ` +
    `viewBox="0 0 ${t.widthDots} ${t.heightDots}">` +
    `<rect x="0" y="0" width="${t.widthDots}" height="${t.heightDots}" fill="#fff"/>` +
    `${inner}</svg>`
  )
}

/**
 * The same label content as `buildLabelSvg`, but pre-rotated 90° and
 * wrapped in a physically portrait-shaped page (dimensions swapped) — the
 * fix for Chrome's own print dialog defaulting to Portrait for this label's
 * landscape (wider-than-tall) size and not self-correcting (confirmed
 * directly: switching Layout to Landscape by hand in the OS's own print
 * dialog prints correctly; leaving the browser dialog on its default
 * Portrait choice instead shrinks the whole label down to fit a taller,
 * narrower page). Declaring the page already-portrait to match that default
 * and rotating the artwork to compensate means the default choice comes out
 * right without a manual step.
 *
 * Uses the SVG element's own native `transform` attribute with explicit dot
 * values (`translate(...) rotate(...)`) rather than a CSS `transform` with
 * percentage values on the `<svg>` element — a first attempt at this exact
 * fix used the CSS/percentage approach and it silently rotated the wrong
 * way (confirmed against a real physical print, not just the preview),
 * most likely because CSS percentage translations don't reliably resolve
 * against an `<svg>` element's own height the way they would on a plain
 * HTML block. SVG's own `transform` attribute has no such ambiguity — the
 * two possible directions (`'cw'`/`'ccw'`) were verified with a small
 * coordinate-transform simulation before being wired up here, confirming
 * both fill the swapped page exactly and read in opposite directions, but
 * only a real test print (via the Settings › Label template Orientation
 * panel, previewed before ever being trusted) can confirm which direction
 * is actually right-side-up on this printer.
 */
export function buildRotatedLabelSvg(
  product: PrintableLabel,
  template: LabelTemplate,
  logoDataUrl: string | undefined,
  direction: 'cw' | 'ccw',
): string {
  const t = template
  const W = t.widthDots
  const H = t.heightDots
  const widthIn = W / t.dpi
  const heightIn = H / t.dpi
  const inner = buildLabelParts(product, template, logoDataUrl)
  // Both land the WxH content exactly onto the swapped HxW page, just
  // rotated opposite directions — see this function's doc comment above.
  const groupTransform = direction === 'cw' ? `translate(${H},0) rotate(90)` : `translate(0,${W}) rotate(-90)`
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${heightIn}in" height="${widthIn}in" ` +
    `viewBox="0 0 ${H} ${W}">` +
    `<rect x="0" y="0" width="${H}" height="${W}" fill="#fff"/>` +
    `<g transform="${groupTransform}">${inner}</g></svg>`
  )
}

const PRINT_CONTAINER_ID = 'stockflow-print-label'
const PRINT_STYLE_ID = 'stockflow-print-label-style'

/**
 * Prints one product label through the browser's own print dialog, to
 * whichever printer the user picks there (in practice, the Polono, once its
 * driver has it registered as a normal system printer — see the note on
 * `PrinterKind` in `labelTemplate.ts` for why this exists alongside the
 * Zebra's raw-socket path rather than replacing it).
 *
 * How it works: builds the label as an SVG sized to its true physical
 * dimensions, drops it into a dedicated container appended to the page, and
 * uses an injected `@page` rule plus `display: none` on everything else to
 * make sure only the label itself ends up on the printed page — an
 * off-the-shelf trick for printing one exact-size element out of a larger
 * app, since the browser's print dialog otherwise prints "the page" as a
 * whole. The container is removed again once printing finishes (or is
 * cancelled) via the `afterprint` event, with a timeout backstop in case
 * that event doesn't fire.
 *
 * `rotation` (default `'off'`) selects between the normal, unrotated SVG
 * (`buildLabelSvg`, `@page` declared in the label's own landscape
 * dimensions — today's default behaviour, unchanged) and the pre-rotated
 * one (`buildRotatedLabelSvg`, `@page` declared portrait to match) — see
 * `PolonoPrintRotation` in `labelTemplate.ts` for the full reasoning and
 * why this defaults to off rather than guessing a direction.
 */
export function printLabelViaBrowser(
  product: PrintableLabel,
  template: LabelTemplate,
  logoDataUrl: string | undefined,
  rotation: PolonoPrintRotation = 'off',
): Result<true> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { ok: false, error: 'Printing needs a browser window.' }
  }

  // Clean up anything left over from an interrupted previous print (e.g. the
  // tab was closed mid-dialog, so `afterprint` never fired) before starting
  // a new one. `querySelectorAll` rather than `getElementById` deliberately
  // — the latter only ever returns the first match, which would leave a
  // second stray node behind in the (invalid, but browsers tolerate it)
  // case of a duplicate id.
  document.querySelectorAll(`#${PRINT_CONTAINER_ID}`).forEach((el) => el.remove())
  document.querySelectorAll(`#${PRINT_STYLE_ID}`).forEach((el) => el.remove())

  const labelWidthIn = template.widthDots / template.dpi
  const labelHeightIn = template.heightDots / template.dpi
  // The physical page declared to the print dialog: the label's own
  // dimensions when not rotating, or swapped (portrait) to match the
  // pre-rotated artwork otherwise.
  const pageWidthIn = rotation === 'off' ? labelWidthIn : labelHeightIn
  const pageHeightIn = rotation === 'off' ? labelHeightIn : labelWidthIn
  const svg =
    rotation === 'off'
      ? buildLabelSvg(product, template, logoDataUrl)
      : buildRotatedLabelSvg(product, template, logoDataUrl, rotation)

  const style = document.createElement('style')
  style.id = PRINT_STYLE_ID
  style.textContent = `
    #${PRINT_CONTAINER_ID} { position: fixed; left: -10000px; top: 0; }
    @media print {
      @page { size: ${pageWidthIn}in ${pageHeightIn}in; margin: 0; }
      /* styles.css sets body { min-height: 100vh } unconditionally (not
         scoped to screen media) so the app fills the viewport on load. That
         rule is still in effect here even though .app itself is hidden
         below — some browsers resolve vh during print against the original
         screen viewport rather than the tiny label @page size, so without
         this reset, body's box stays "at least one screen-height" tall and
         the print engine pads out extra blank pages/labels to cover the
         rest of it: one real label printed, then several blank ones fed
         and cut after it. Exactly the class of bug PrintPortal.tsx's own
         doc comment describes already having been fixed once for receipts
         (there via visibility:hidden reserving layout space) — this is the
         same failure mode showing up again via min-height instead. */
      html, body { min-height: 0 !important; height: auto !important; }
      body > :not(#${PRINT_CONTAINER_ID}) { display: none !important; }
      #${PRINT_CONTAINER_ID} { position: static !important; left: auto !important; }
    }
  `

  const container = document.createElement('div')
  container.id = PRINT_CONTAINER_ID
  container.innerHTML = svg

  document.head.appendChild(style)
  document.body.appendChild(container)

  const cleanup = () => {
    container.remove()
    style.remove()
    window.removeEventListener('afterprint', cleanup)
  }
  window.addEventListener('afterprint', cleanup)
  setTimeout(cleanup, 60_000)

  try {
    window.print()
  } catch (cause) {
    cleanup()
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) }
  }

  return { ok: true, value: true }
}
