import { describe, expect, it } from 'vitest'
import { buildCpclLabel } from './cpcl'
import type { CpclLogo } from './bitmap'
import { DEFAULT_LABEL_TEMPLATE } from './labelTemplate'

describe('buildCpclLabel', () => {
  it('opens with darkness/speed setvars then the CPCL header, and ends with FORM/PRINT', () => {
    const cpcl = buildCpclLabel({ name: 'Widget', sku: 'SKU-001' })
    const lines = cpcl.trim().split('\r\n')
    expect(lines[0]).toBe(`! U1 setvar "print.tone" "${DEFAULT_LABEL_TEMPLATE.darkness.toFixed(1)}"`)
    expect(lines[1]).toBe(`! U1 setvar "media.speed" "${DEFAULT_LABEL_TEMPLATE.printSpeedIps}"`)
    expect(lines[2]).toBe(`! 0 ${DEFAULT_LABEL_TEMPLATE.dpi} ${DEFAULT_LABEL_TEMPLATE.dpi} ${DEFAULT_LABEL_TEMPLATE.heightDots} 1`)
    expect(lines.at(-2)).toBe('FORM')
    expect(lines.at(-1)).toBe('PRINT')
  })

  it('includes the product name as a TEXT command', () => {
    const cpcl = buildCpclLabel({ name: 'Cordless Drill 18V', sku: 'SKU-001' })
    expect(cpcl).toContain('Cordless Drill 18V')
  })

  it('encodes the SKU as a Code 128 barcode', () => {
    const cpcl = buildCpclLabel({ name: 'Widget', sku: 'SKU-042' })
    expect(cpcl).toMatch(/BARCODE 128 .* SKU-042/)
  })

  it('omits the variation line when there is no variation', () => {
    const cpcl = buildCpclLabel({ name: 'Widget', sku: 'SKU-001' })
    expect(cpcl).not.toContain('Variation:')
  })

  it('includes the variation when set', () => {
    const cpcl = buildCpclLabel({ name: 'Widget', sku: 'SKU-001', variation: 'Blue' })
    expect(cpcl).toContain('Variation: Blue')
  })

  it('emits an EG bitmap command for the logo at its own template position', () => {
    const logo: CpclLogo = { widthBytes: 10, heightDots: 40, hex: 'AB'.repeat(10 * 40) }
    const withLogo = buildCpclLabel({ name: 'Widget', sku: 'SKU-001', logo })
    const withoutLogo = buildCpclLabel({ name: 'Widget', sku: 'SKU-001' })

    expect(withLogo).toContain(`EG ${logo.widthBytes} ${logo.heightDots} 20 20 ${logo.hex}`)
    // The logo and text are positioned independently now (drag-to-place), so
    // adding a logo does not move where the name prints.
    const textXWith = /TEXT 7 0 (\d+) 20 Widget/.exec(withLogo)?.[1]
    const textXWithout = /TEXT 7 0 (\d+) 20 Widget/.exec(withoutLogo)?.[1]
    expect(textXWith).toBe(textXWithout)
  })

  it('clamps the logo position at print time using the real bitmap size, even if the stored template is stale', () => {
    // A bigger logo than the editor's assumed 120x60 footprint, deliberately
    // positioned via a template that would let it hang off a 600x300 label —
    // the defensive check in buildCpclLabel itself, independent of whatever
    // sanitiseLabelTemplate already did when the template was saved.
    const logo: CpclLogo = { widthBytes: 30, heightDots: 100, hex: 'AB'.repeat(30 * 100) } // 240 dots wide
    const cpcl = buildCpclLabel({
      name: 'Widget',
      sku: 'SKU-001',
      logo,
      template: {
        widthDots: 600,
        heightDots: 300,
        dpi: 200,
        nameFont: 7,
        variationFont: 4,
        skuFont: 4,
        barcodeHeight: 60,
        barcodeModuleWidth: 2,
        logoWidthDots: 120,
        logoHeightDots: 60,
        logo: { x: 590, y: 290 }, // would print the 240x100 bitmap far off the label
        name: { x: 160, y: 20 },
        variation: { x: 160, y: 65 },
        barcode: { x: 160, y: 100 },
        sku: { x: 160, y: 180 },
        darkness: 14,
        printSpeedIps: 2,
        include: { name: true, variation: true, barcode: true, sku: true, logo: true },
      },
    })
    const match = /EG 30 100 (\d+) (\d+) /.exec(cpcl)
    expect(match).not.toBeNull()
    const [, x, y] = match!
    expect(Number(x)).toBeLessThanOrEqual(600 - 240)
    expect(Number(y)).toBeLessThanOrEqual(300 - 100)
  })

  it('sends the barcode module width from the template as the BARCODE command width parameter', () => {
    const cpcl = buildCpclLabel({
      name: 'Widget',
      sku: 'SKU-001',
      template: { ...DEFAULT_LABEL_TEMPLATE, barcodeModuleWidth: 4 },
    })
    expect(cpcl).toMatch(/BARCODE 128 4 1 /)
  })

  it('omits an unticked element from the printed CPCL entirely, keeping the rest', () => {
    const logo: CpclLogo = { widthBytes: 10, heightDots: 40, hex: 'AB'.repeat(10 * 40) }
    const cpcl = buildCpclLabel({
      name: 'Widget',
      sku: 'SKU-001',
      variation: 'Blue',
      logo,
      template: {
        ...DEFAULT_LABEL_TEMPLATE,
        include: { name: false, variation: true, barcode: true, sku: true, logo: false },
      },
    })
    expect(cpcl).not.toContain('Widget')
    expect(cpcl).not.toContain('EG ')
    expect(cpcl).toContain('Variation: Blue')
    expect(cpcl).toMatch(/BARCODE 128 .* SKU-001/)
  })

  it('drops the barcode line when barcode is unticked but keeps the SKU text', () => {
    const cpcl = buildCpclLabel({
      name: 'Widget',
      sku: 'SKU-001',
      template: { ...DEFAULT_LABEL_TEMPLATE, include: { name: true, variation: true, barcode: false, sku: true, logo: true } },
    })
    expect(cpcl).not.toMatch(/BARCODE 128/)
    expect(cpcl).toContain('SKU-001')
  })

  it('strips embedded line breaks so a rogue value cannot inject a CPCL command', () => {
    const cpcl = buildCpclLabel({ name: 'Widget\r\nEXTRA COMMAND', sku: 'SKU-001' })
    const lines = cpcl.trim().split('\r\n')
    expect(lines.some((line) => line === 'EXTRA COMMAND')).toBe(false)
    expect(cpcl).toContain('Widget EXTRA COMMAND')
  })
})
