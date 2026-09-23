import { BitArray, Code128Reader } from '@zxing/library'
import { describe, expect, it } from 'vitest'
import { DEFAULT_BARCODE_LABEL_LAYOUT, type BarcodeLabelLayout } from './barcodeLabelLayout'
import { fitText, formatLabelPrice, planBarcodeLabel, type BarsOp, type MeasureText, type TextOp } from './barcodeLabelPlan'

/** Fake font metrics: every glyph is 0.55em wide, bold 10% wider. */
const measure: MeasureText = (text, px, bold) => text.length * px * 0.55 * (bold ? 1.1 : 1)

const content = { name: 'Vintage Denim Jacket', sku: 'SKU-018', variation: 'Large', price: 24.5 }

const layoutWith = (patch: Partial<BarcodeLabelLayout>): BarcodeLabelLayout => ({ ...DEFAULT_BARCODE_LABEL_LAYOUT, ...patch })

/** Rasterises a bars op back into a single printed row and decodes it with zxing. */
function scan(op: BarsOp): string {
  const row = new BitArray(406)
  for (const [x, w] of op.runs) for (let i = x; i < x + w; i++) row.set(i)
  return new Code128Reader().decodeRow(0, row).getText()
}

describe('fitText', () => {
  it('keeps the requested size when the text fits', () => {
    expect(fitText('Hi', 300, 40, 30, false, measure)).toEqual({ text: 'Hi', fontPx: 30, shortened: false })
  })

  it('never uses a size taller than the box', () => {
    expect(fitText('Hi', 300, 20, 60, false, measure).fontPx).toBeLessThanOrEqual(20)
  })

  it('shrinks before it shortens', () => {
    const fitted = fitText('Twelve chars', 160, 40, 30, false, measure)
    expect(fitted.shortened).toBe(false)
    expect(fitted.fontPx).toBeLessThan(30)
    expect(measure(fitted.text, fitted.fontPx, false)).toBeLessThanOrEqual(160)
  })

  it('shortens with an ellipsis once shrinking to 60% is not enough', () => {
    const fitted = fitText('A very long product name that will never fit', 150, 40, 30, false, measure)
    expect(fitted.shortened).toBe(true)
    expect(fitted.text.endsWith('…')).toBe(true)
    expect(measure(fitted.text, fitted.fontPx, false)).toBeLessThanOrEqual(150)
  })
})

describe('planBarcodeLabel', () => {
  it('is sized to the 2 × 1 label at 203 dpi', () => {
    const plan = planBarcodeLabel(DEFAULT_BARCODE_LABEL_LAYOUT, content, measure, { hasLogo: false })
    expect([plan.width, plan.height]).toEqual([406, 203])
  })

  it('draws a barcode that scans back to the SKU', () => {
    const plan = planBarcodeLabel(DEFAULT_BARCODE_LABEL_LAYOUT, content, measure, { hasLogo: false })
    const bars = plan.ops.find((op): op is BarsOp => op.kind === 'bars')!
    expect(scan(bars)).toBe('SKU-018')
  })

  it('uses whole-dot bar widths and keeps the bars inside the barcode box', () => {
    const plan = planBarcodeLabel(DEFAULT_BARCODE_LABEL_LAYOUT, content, measure, { hasLogo: false })
    const bars = plan.ops.find((op): op is BarsOp => op.kind === 'bars')!
    const box = DEFAULT_BARCODE_LABEL_LAYOUT.barcode
    expect(Number.isInteger(bars.moduleWidth)).toBe(true)
    expect(bars.moduleWidth).toBeGreaterThanOrEqual(2)
    for (const [x, w] of bars.runs) {
      expect(Number.isInteger(x) && Number.isInteger(w)).toBe(true)
      expect(x).toBeGreaterThanOrEqual(box.x)
      expect(x + w).toBeLessThanOrEqual(box.x + box.w)
    }
  })

  it('uses thinner bars for a longer SKU, and still scans', () => {
    const plan = planBarcodeLabel(DEFAULT_BARCODE_LABEL_LAYOUT, { ...content, sku: 'LONGER-SKU-000123' }, measure, {
      hasLogo: false,
    })
    const bars = plan.ops.find((op): op is BarsOp => op.kind === 'bars')!
    expect(bars.moduleWidth).toBe(1)
    expect(scan(bars)).toBe('LONGER-SKU-000123')
  })

  it('warns when the SKU is too long for the barcode box', () => {
    const layout = layoutWith({ barcode: { ...DEFAULT_BARCODE_LABEL_LAYOUT.barcode, w: 60 } })
    const plan = planBarcodeLabel(layout, content, measure, { hasLogo: false })
    expect(plan.warnings.some((w) => w.key === 'barcode')).toBe(true)
  })

  it('warns instead of drawing bars for a SKU a barcode cannot hold', () => {
    const plan = planBarcodeLabel(DEFAULT_BARCODE_LABEL_LAYOUT, { ...content, sku: 'CAFÉ-1' }, measure, { hasLogo: false })
    expect(plan.ops.some((op) => op.kind === 'bars')).toBe(false)
    expect(plan.warnings[0].key).toBe('barcode')
  })

  it('leaves out hidden elements and empty values', () => {
    const plan = planBarcodeLabel(DEFAULT_BARCODE_LABEL_LAYOUT, { name: 'X', sku: 'S1' }, measure, { hasLogo: true })
    const keys = plan.ops.filter((op): op is TextOp => op.kind === 'text').map((op) => op.key)
    expect(keys).toEqual(['name', 'sku']) // no variation value; price and logo hidden by default
    expect(plan.ops.some((op) => op.kind === 'logo')).toBe(false)
  })

  it('only places the logo when it is switched on and there is one', () => {
    const layout = layoutWith({ logo: { ...DEFAULT_BARCODE_LABEL_LAYOUT.logo, visible: true } })
    expect(planBarcodeLabel(layout, content, measure, { hasLogo: false }).ops.some((op) => op.kind === 'logo')).toBe(false)
    expect(planBarcodeLabel(layout, content, measure, { hasLogo: true }).ops.some((op) => op.kind === 'logo')).toBe(true)
  })

  it('anchors text by its alignment', () => {
    const layout = layoutWith({ price: { ...DEFAULT_BARCODE_LABEL_LAYOUT.price, visible: true } })
    const plan = planBarcodeLabel(layout, content, measure, { hasLogo: false })
    const price = plan.ops.find((op): op is TextOp => op.kind === 'text' && op.key === 'price')!
    expect(price.text).toBe('£24.50')
    expect(price.x).toBe(layout.price.x + layout.price.w)
  })
})

describe('formatLabelPrice', () => {
  it('formats pounds and hides zero/missing prices', () => {
    expect(formatLabelPrice(3)).toBe('£3.00')
    expect(formatLabelPrice(0)).toBe('')
    expect(formatLabelPrice(undefined)).toBe('')
  })
})
