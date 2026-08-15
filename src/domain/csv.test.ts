import { describe, expect, it } from 'vitest'
import type { Product, ReturnCase, Sale, StockMovement } from './types'
import { escapeCsvValue, movementsToCsv, productsToCsv, returnsToCsv, salesToCsv, toCsv } from './csv'

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
    variation: '',
    quantity: 3,
    reorderLevel: 5,
    cost: 1.2,
    price: 4.5,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  }

  it('exports the catalogue columns with escaping applied', () => {
    const lines = productsToCsv([product]).split('\r\n')
    expect(lines[0]).toBe(
      'Barcode,SKU,Name,Category,Location,Variation,Quantity,Reorder Level,Cost,Price,Low Stock,Updated',
    )
    expect(lines[1]).toBe(
      '5012345678900,"SKU,1","M6 ""hex"" bolt",Fasteners,A1,,3,5,1.2,4.5,yes,2026-01-02T00:00:00.000Z',
    )
  })

  it('flags a healthy product as not low stock', () => {
    const csv = productsToCsv([{ ...product, quantity: 10 }])
    expect(csv.split('\r\n')[1]).toContain(',10,5,1.2,4.5,no,')
  })
})

describe('salesToCsv', () => {
  const sale: Sale = {
    id: 's1',
    channel: 'eBay',
    paymentMethod: 'card',
    subtotal: 25,
    totalCost: 10,
    profit: 15,
    createdAt: '2026-02-02T10:00:00.000Z',
    lines: [
      {
        id: 'l1',
        saleId: 's1',
        productId: 'p1',
        sku: 'BLT-M6',
        name: 'M6 Bolt',
        quantity: 5,
        unitPrice: 5,
        unitCost: 2,
        lineTotal: 25,
        lineProfit: 15,
      },
    ],
  }

  it('exports the sale columns with items summarised', () => {
    const lines = salesToCsv([sale]).split('\r\n')
    expect(lines[0]).toBe(
      'Timestamp,Channel,Payment Method,Items,Subtotal,Cost,Buyer Protection Fee,Buyer Protection Fee Paid By,Delivery Cost,Delivery Paid By,VAT,Advertising Cost,Order Total,Profit',
    )
    // No fees were entered on this sale, so every fee column reads as a
    // plain 0.00 (or blank, for the reconciliation-only order total) rather
    // than throwing on the missing/optional fields.
    expect(lines[1]).toBe(
      '2026-02-02T10:00:00.000Z,eBay,Card,5x BLT-M6,25.00,10.00,0.00,Me,0.00,Me,0.00,0.00,,15.00',
    )
  })

  it('exports marketplace fees and a buyer-paid order total when they were entered', () => {
    const withFees: Sale = {
      ...sale,
      buyerProtectionFee: 1.5,
      buyerProtectionFeePaidBy: 'buyer',
      deliveryCost: 3.99,
      deliveryPaidBy: 'buyer',
      vat: 2.1,
      advertisingCost: 0.75,
      orderTotal: 30.49,
    }
    const lines = salesToCsv([withFees]).split('\r\n')
    expect(lines[1]).toBe(
      '2026-02-02T10:00:00.000Z,eBay,Card,5x BLT-M6,25.00,10.00,1.50,Buyer,3.99,Buyer,2.10,0.75,30.49,15.00',
    )
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

describe('returnsToCsv', () => {
  const returnCase: ReturnCase = {
    id: 'r1',
    saleId: 's1',
    channel: 'eBay',
    customerRef: 'jane@example.com',
    reason: 'Faulty',
    notes: '',
    actions: ['refund', 'return'],
    refundAmount: 12.5,
    refundMethod: 'card',
    goodwillType: '',
    goodwillValue: 0,
    returnLines: [
      {
        id: 'l1',
        returnId: 'r1',
        productId: 'p1',
        sku: 'BLT-M6',
        name: 'M6 Bolt',
        quantity: 2,
        disposition: 'writeoff',
        unitCost: 2,
      },
    ],
    replacementLines: [],
    createdAt: '2026-02-02T10:00:00.000Z',
  }

  it('exports the case columns with items and financial impact resolved', () => {
    const lines = returnsToCsv([returnCase]).split('\r\n')
    expect(lines[0]).toBe(
      'Timestamp,Channel,Customer,Actions,Returned Items,Replacement Items,Refund Amount,Refund Method,Goodwill Type,Goodwill Value,Write-off Loss,Total Cost,Reason,Notes',
    )
    expect(lines[1]).toBe(
      '2026-02-02T10:00:00.000Z,eBay,jane@example.com,Refund; Return,2x BLT-M6 (writeoff),,12.50,Card,,0.00,4.00,16.50,Faulty,',
    )
  })

  it('leaves refund method blank when there is none', () => {
    const csv = returnsToCsv([{ ...returnCase, refundMethod: null }])
    expect(csv.split('\r\n')[1]).toContain(',12.50,,')
  })
})
