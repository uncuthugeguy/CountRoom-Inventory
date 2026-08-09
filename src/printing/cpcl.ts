import type { CpclLogo } from './bitmap'
import { DEFAULT_LABEL_TEMPLATE, type LabelTemplate } from './labelTemplate'

export interface CpclLabelInput {
  name: string
  sku: string
  variation?: string
  logo?: CpclLogo
  /** Defaults to `DEFAULT_LABEL_TEMPLATE` — pass `settings.labelTemplate` to use the user's saved layout. */
  template?: LabelTemplate
}

/** CPCL reads each line as a command; strip anything that could start a new one. */
const sanitiseText = (value: string): string => value.replace(/[\r\n]+/g, ' ').trim()

/**
 * Builds a CPCL (Zebra's line-based printer language) job for one product
 * label: the name, a Code 128 barcode of the SKU, the variation (if set) and
 * the uploaded logo (if provided), rendered as an EG bitmap.
 *
 * All sizing and placement comes from `template`, editable in Settings ›
 * Label template — see `labelTemplate.ts` for what each field controls.
 */
export function buildCpclLabel({
  name,
  sku,
  variation,
  logo,
  template = DEFAULT_LABEL_TEMPLATE,
}: CpclLabelInput): string {
  const t = template

  const lines: string[] = [
    // offset, x-resolution, y-resolution, label length in dots, copies
    `! 0 ${t.dpi} ${t.dpi} ${t.heightDots} 1`,
    `PAGE-WIDTH ${t.widthDots}`,
  ]

  if (logo) {
    // Belt-and-braces: the saved template is already sanitised to keep the
    // logo on the label, but this uses the *real* rasterised bitmap's size
    // (rather than the fixed size the editor assumes every logo scales to)
    // right before the command that actually matters — CPCL's EG has no
    // on-printer clipping, so if this bitmap ever overran PAGE-WIDTH it
    // would corrupt everything printed after it, not just look wrong.
    const logoWidthDots = logo.widthBytes * 8
    const logoX = Math.max(0, Math.min(t.logo.x, t.widthDots - logoWidthDots))
    const logoY = Math.max(0, Math.min(t.logo.y, t.heightDots - logo.heightDots))
    lines.push(`EG ${logo.widthBytes} ${logo.heightDots} ${logoX} ${logoY} ${logo.hex}`)
  }

  lines.push(`TEXT ${t.nameFont} 0 ${t.name.x} ${t.name.y} ${sanitiseText(name)}`)

  if (variation) {
    lines.push(`TEXT ${t.variationFont} 0 ${t.variation.x} ${t.variation.y} ${sanitiseText(`Variation: ${variation}`)}`)
  }

  const cleanSku = sanitiseText(sku)
  const moduleWidth = t.barcodeModuleWidth ?? 1
  lines.push(`BARCODE 128 ${moduleWidth} 1 ${t.barcodeHeight} ${t.barcode.x} ${t.barcode.y} ${cleanSku}`)
  lines.push(`TEXT ${t.skuFont} 0 ${t.sku.x} ${t.sku.y} ${cleanSku}`)

  lines.push('FORM')
  lines.push('PRINT')

  return lines.join('\r\n') + '\r\n'
}
