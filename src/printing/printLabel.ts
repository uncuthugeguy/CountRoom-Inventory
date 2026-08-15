import type { Settings } from '../data/settingsStorage'
import type { Product, Result } from '../domain/types'
import { toMonochromeBitmap, type CpclLogo } from './bitmap'
import { buildCpclLabel } from './cpcl'
import { DEFAULT_LABEL_TEMPLATE } from './labelTemplate'
import { rasterizeLogo } from './logoRaster'
import { sendToPrinter } from './printerClient'

/**
 * Builds a CPCL label for a product — name, SKU barcode, variation and the
 * uploaded logo — and sends it to the Zebra printer. A logo that fails to
 * load is dropped rather than failing the whole print, since a label
 * without a logo is still useful.
 */
export async function printProductLabel(
  product: Product,
  settings: Settings,
): Promise<Result<true>> {
  const template = settings.labelTemplate ?? DEFAULT_LABEL_TEMPLATE

  let logo: CpclLogo | undefined
  if (settings.logoDataUrl && template.include.logo) {
    try {
      const raster = await rasterizeLogo(settings.logoDataUrl, template.logoWidthDots, template.logoHeightDots)
      logo = toMonochromeBitmap(raster)
    } catch {
      logo = undefined
    }
  }

  const cpcl = buildCpclLabel({
    name: product.name,
    sku: product.sku,
    variation: product.variation || undefined,
    logo,
    template,
  })

  return sendToPrinter(cpcl)
}
