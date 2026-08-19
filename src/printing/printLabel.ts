import type { Settings } from '../data/settingsStorage'
import type { Product, Result } from '../domain/types'
import { toMonochromeBitmap, type CpclLogo } from './bitmap'
import { printLabelViaBrowser } from './browserLabelPrint'
import { buildCpclLabel } from './cpcl'
import { DEFAULT_LABEL_TEMPLATE, DEFAULT_POLONO_LABEL_TEMPLATE } from './labelTemplate'
import { rasterizeLogo } from './logoRaster'
import { sendToPrinter } from './printerClient'

/**
 * Prints a product label — name, SKU barcode, variation and the uploaded
 * logo — to whichever printer `settings.printerKind` selects (defaults to
 * `'zebra'` so existing setups keep behaving exactly as before). The two
 * paths are genuinely different, not just a different template:
 *
 * - Zebra: builds a raw CPCL command string and sends it straight to the
 *   printer's network port (`printerClient.ts`) with no dialog — the logo
 *   has to be pre-converted to a monochrome bitmap since CPCL's `EG` command
 *   only understands that.
 * - Polono: renders the label as an SVG and opens the browser's own print
 *   dialog (`browserLabelPrint.ts`), relying on the Polono's official
 *   driver to have registered it as a normal system printer — see the
 *   `PrinterKind` doc comment in `labelTemplate.ts` for why.
 */
export async function printProductLabel(
  product: Product,
  settings: Settings,
): Promise<Result<true>> {
  if (settings.printerKind === 'polono') {
    const template = settings.polonoLabelTemplate ?? DEFAULT_POLONO_LABEL_TEMPLATE
    return printLabelViaBrowser(
      { name: product.name, sku: product.sku, variation: product.variation || undefined },
      template,
      settings.logoDataUrl,
    )
  }

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
