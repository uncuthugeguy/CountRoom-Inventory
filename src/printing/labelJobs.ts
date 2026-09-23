import type { Settings } from '../data/settingsStorage'
import type { Product, Result } from '../domain/types'
import { DEFAULT_BARCODE_LABEL_LAYOUT, type BarcodeLabelLayout } from './barcodeLabelLayout'
import { planBarcodeLabel, type LabelContent, type LabelWarning } from './barcodeLabelPlan'
import { LABEL_MEDIA, type LabelSize } from './labelMedia'
import { printLabelPage } from './labelPrint'
import { DEFAULT_LABEL_PRINTER_SETTINGS } from './labelPrinterSettings'
import { applyCalibration, canvasMeasure, loadImage, paintAlignmentTest, paintLabelPlan } from './labelRaster'

/**
 * The few things the rest of the app calls to print. Each one renders the
 * label at the Polono's exact resolution, applies this device's calibration
 * and hands it to `printLabelPage`.
 */

export const contentForProduct = (product: Pick<Product, 'name' | 'sku' | 'variation' | 'price'>): LabelContent => ({
  name: product.name,
  sku: product.sku,
  variation: product.variation || undefined,
  price: product.price,
})

export async function renderBarcodeLabel(
  layout: BarcodeLabelLayout,
  content: LabelContent,
  logoDataUrl: string | undefined,
): Promise<{ canvas: HTMLCanvasElement; warnings: LabelWarning[] }> {
  let logo: HTMLImageElement | undefined
  if (logoDataUrl && layout.logo.visible) {
    try {
      logo = await loadImage(logoDataUrl)
    } catch {
      logo = undefined
    }
  }
  const plan = planBarcodeLabel(layout, content, canvasMeasure(), { hasLogo: !!logo })
  return { canvas: paintLabelPlan(plan, logo), warnings: plan.warnings }
}

const printerFor = (settings: Settings) => settings.labelPrinter ?? DEFAULT_LABEL_PRINTER_SETTINGS

async function printCanvas(
  canvas: HTMLCanvasElement,
  size: LabelSize,
  settings: Settings,
  copies: number,
): Promise<Result<true>> {
  const printer = printerFor(settings)
  const page = applyCalibration(canvas, LABEL_MEDIA[size], printer.calibration[size])
  return printLabelPage(page, { copies, ...(printer.printerName ? { printerName: printer.printerName } : {}) })
}

const fail = (cause: unknown): Result<true> => ({
  ok: false,
  error: cause instanceof Error ? cause.message : String(cause),
})

/** Prints `copies` 2 × 1 barcode labels for one product. */
export async function printProductLabel(
  product: Pick<Product, 'name' | 'sku' | 'variation' | 'price'>,
  settings: Settings,
  copies = 1,
): Promise<Result<true>> {
  if (!product.sku.trim()) return { ok: false, error: 'This product has no SKU to put on a barcode.' }
  try {
    const layout = settings.barcodeLabelLayout ?? DEFAULT_BARCODE_LABEL_LAYOUT
    const { canvas } = await renderBarcodeLabel(layout, contentForProduct(product), settings.logoDataUrl)
    return await printCanvas(canvas, '2x1', settings, copies)
  } catch (cause) {
    return fail(cause)
  }
}

/** Prints an already-composed 4 × 6 shipping label (812 × 1218 dots). */
export async function printShippingLabel(canvas: HTMLCanvasElement, settings: Settings, copies = 1): Promise<Result<true>> {
  try {
    return await printCanvas(canvas, '4x6', settings, copies)
  } catch (cause) {
    return fail(cause)
  }
}

/** Border + centre-cross pattern for lining the printer up with the label. */
export async function printAlignmentTest(size: LabelSize, settings: Settings): Promise<Result<true>> {
  try {
    return await printCanvas(paintAlignmentTest(LABEL_MEDIA[size]), size, settings, 1)
  } catch (cause) {
    return fail(cause)
  }
}
