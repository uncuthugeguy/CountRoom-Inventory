import type { CpclLogo } from './bitmap'

export interface CpclLabelInput {
  name: string
  sku: string
  variation?: string
  logo?: CpclLogo
}

/** A 3in x 1.5in label at 200 dpi — comfortable room for a logo, name, barcode and variation. */
const LABEL_WIDTH_DOTS = 600
const LABEL_HEIGHT_DOTS = 300
const MARGIN = 20

/** CPCL reads each line as a command; strip anything that could start a new one. */
const sanitiseText = (value: string): string => value.replace(/[\r\n]+/g, ' ').trim()

/**
 * Builds a CPCL (Zebra's line-based printer language) job for one product
 * label: the name, a Code 128 barcode of the SKU, the variation (if set) and
 * the uploaded logo (if provided), rendered as an EG bitmap.
 */
export function buildCpclLabel({ name, sku, variation, logo }: CpclLabelInput): string {
  const textX = logo ? MARGIN + logo.widthBytes * 8 + MARGIN : MARGIN

  const lines: string[] = [
    // offset, x-resolution, y-resolution, label length in dots, copies
    `! 0 200 200 ${LABEL_HEIGHT_DOTS} 1`,
    `PAGE-WIDTH ${LABEL_WIDTH_DOTS}`,
  ]

  if (logo) {
    lines.push(`EG ${logo.widthBytes} ${logo.heightDots} ${MARGIN} ${MARGIN} ${logo.hex}`)
  }

  lines.push(`TEXT 7 0 ${textX} ${MARGIN} ${sanitiseText(name)}`)

  let y = MARGIN + 45
  if (variation) {
    lines.push(`TEXT 4 0 ${textX} ${y} ${sanitiseText(`Variation: ${variation}`)}`)
    y += 35
  }

  const cleanSku = sanitiseText(sku)
  lines.push(`BARCODE 128 1 1 60 ${textX} ${y} ${cleanSku}`)
  y += 80
  lines.push(`TEXT 4 0 ${textX} ${y} ${cleanSku}`)

  lines.push('FORM')
  lines.push('PRINT')

  return lines.join('\r\n') + '\r\n'
}
