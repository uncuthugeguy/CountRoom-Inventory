import { describe, expect, it } from 'vitest'
import { buildCpclLabel } from './cpcl'
import type { CpclLogo } from './bitmap'

describe('buildCpclLabel', () => {
  it('opens with a CPCL header and ends with FORM/PRINT', () => {
    const cpcl = buildCpclLabel({ name: 'Widget', sku: 'SKU-001' })
    const lines = cpcl.trim().split('\r\n')
    expect(lines[0]).toMatch(/^! 0 200 200 \d+ 1$/)
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

  it('emits an EG bitmap command for the logo and indents the text past it', () => {
    const logo: CpclLogo = { widthBytes: 10, heightDots: 40, hex: 'AB'.repeat(10 * 40) }
    const withLogo = buildCpclLabel({ name: 'Widget', sku: 'SKU-001', logo })
    const withoutLogo = buildCpclLabel({ name: 'Widget', sku: 'SKU-001' })

    expect(withLogo).toContain(`EG ${logo.widthBytes} ${logo.heightDots} 20 20 ${logo.hex}`)

    const textXWith = /TEXT 7 0 (\d+) 20 Widget/.exec(withLogo)?.[1]
    const textXWithout = /TEXT 7 0 (\d+) 20 Widget/.exec(withoutLogo)?.[1]
    expect(Number(textXWith)).toBeGreaterThan(Number(textXWithout))
  })

  it('strips embedded line breaks so a rogue value cannot inject a CPCL command', () => {
    const cpcl = buildCpclLabel({ name: 'Widget\r\nEXTRA COMMAND', sku: 'SKU-001' })
    const lines = cpcl.trim().split('\r\n')
    expect(lines.some((line) => line === 'EXTRA COMMAND')).toBe(false)
    expect(cpcl).toContain('Widget EXTRA COMMAND')
  })
})
