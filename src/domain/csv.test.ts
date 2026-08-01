import { describe, expect, it } from 'vitest'
import type { Product, StockMovement } from './types'
import { escapeCsvValue, movementsToCsv, productsToCsv, toCsv } from './csv'

describe('escapeCsvValue', () => {
  it('leaves a plain value untouched', () => {
    expect(escapeCsvValue('Widget')).toBe('Widget')
  })

  it('quotes a value containing a comma', () => {
    expect(escapeCsvValue('Bolt, hex head')).toBe('"Bolt, hex head"')
  })

  it('quotes and doubles embedded double quotes', () => {
    expect(escapeCsvValue('6" pipe')).toBe('"6"" pipe"')
  })

  it('quotes a value containing a newline', () => {
    expect(escapeCsvValue('line1\nline2')).toBe('"line1\nline2"')
  })

  it('quotes a value containing a carriage return', () => {
    expect(escapeCsvValue('line1\r\nline2')).toBe('"line1\r\nline2"')
  })

  it('quotes values with leading or trailing spaces so they survive a round trip', () => {
    expect(escapeCsvValue('  padded  ')).toBe('"  padded  "')
  })

  it('renders numbers and booleans without quotes', () => {
    expect(escapeCsvValue(42)).toBe('42')
    expect(escapeCsvValue(0)).toBe('0')
    expect(escapeCsvValue(false)).toBe('false')
  })

  it('renders null and undefined as an empty field', () => {
    expect(escapeCsvValue(null)).toBe('')
    expect(escapeCsvValue(undefined)).toBe('')
  })

  it('neutralises spreadsheet formula injection', () => {
    expect(escapeCsvValue('=SUM(A1:A2)')).toBe(`"'=SUM(A1:A2)"`)
    expect(escapeCsvValue('+1234')).toBe(`"'+1234"`)
    expect(escapeCsvValue('-1+2')).toBe(`"'-1+2"`)
    expect(escapeCsvValue('@cmd')).toBe(`"'@cmd"`)
  })
})

describe('toCsv', () => {
  it('writes a header row and CRLF line endings', () => {
    const csv = toCsv(
      [{ label: 'Name', value: (r: { name: string }) => r.name }],
      [{ name: 'A' }, { name: 'B' }],
    )
    expect(csv).toBe('Name\r\nA\r\nB')
  })

  it('writes only the header row for no rows', () => {
    expect(toCsv([{ label: 'Name', value: () => '' }], [])).toBe('Name')
  })
})

describe('productsToCsv', () => {
  const product: Product = {
    id: 'p1',
    barcode: '5012345678900',
    sku: 'SKU,1',
    name: 'M6 "hex" bolt',
    category: 'Fasteners',
    location: 'A1',
    quantity: 3,
    reorderLevel: 5,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  }

  it('exports the catalogue columns with escaping applied', () => {
    const lines = productsToCsv([product]).split('\r\n')
    expect(lines[0]).toBe(
      'Barcode,SKU,Name,Category,Location,Quantity,Reorder Level,Low Stock,Updated',
    )
    expect(lines[1]).toBe(
      '5012345678900,"SKU,1","M6 ""hex"" bolt",Fasteners,A1,3,5,yes,2026-01-02T00:00:00.000Z',
    )
  })

  it('flags a healthy product as not low stock', () => {
    const csv = productsToCsv([{ ...product, quantity: 10 }])
    expect(csv.split('\r\n')[1]).toContain(',10,5,no,')
  })
})

describe('movementsToCsv', () => {
  const movement: StockMovement = {
    id: 'm1',
    productId: 'p1',
    type: 'out',
    quantity: 2,
    delta: -2,
    previousQuantity: 10,
    newQuantity: 8,
    reason: 'Sold, boxed',
    createdAt: '2026-02-02T10:00:00.000Z',
  }

  it('exports the audit columns and resolves the product name', () => {
    const lines = movementsToCsv([movement], { p1: 'M6 Bolt' }).split('\r\n')
    expect(lines[0]).toBe(
      'Timestamp,Product,Type,Quantity,Delta,Previous,New,Reason',
    )
    expect(lines[1]).toBe(
      '2026-02-02T10:00:00.000Z,M6 Bolt,out,2,-2,10,8,"Sold, boxed"',
    )
  })

  it('leaves the product blank when it is no longer in the catalogue', () => {
    expect(movementsToCsv([movement], {}).split('\r\n')[1]).toBe(
      '2026-02-02T10:00:00.000Z,,out,2,-2,10,8,"Sold, boxed"',
    )
  })

  it('leaves the reason blank when there is none', () => {
    const csv = movementsToCsv([{ ...movement, reason: undefined }], { p1: 'M6 Bolt' })
    expect(csv.split('\r\n')[1].endsWith(',8,')).toBe(true)
  })
})
