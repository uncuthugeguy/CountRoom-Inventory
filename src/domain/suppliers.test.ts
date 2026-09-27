import { describe, it, expect } from 'vitest'
import {
  poLineTotal,
  calculatePOSubtotal,
  findBestSupplier,
  productsNeedingReorder, calculatePoInvoiceTotals, poLineCostPerItem, poLineTrueCostPerItem } from './suppliers'
import type { PurchaseOrderLine, Supplier, SupplierProduct, PurchaseOrder, PurchaseOrderStatus } from './suppliers'

describe('Supplier Domain', () => {
  describe('poLineTotal', () => {
    it('calculates line total correctly', () => {
      expect(poLineTotal(5, 10)).toBe(50)
      expect(poLineTotal(1, 99.99)).toBe(99.99)
      expect(poLineTotal(100, 0.5)).toBe(50)
    })

    it('handles zero quantity', () => {
      expect(poLineTotal(0, 10)).toBe(0)
    })
  })

  describe('calculatePOSubtotal', () => {
    it('sums all line totals', () => {
      const lines: PurchaseOrderLine[] = [
        {
          id: '1',
          poId: 'po1',
          productId: 'p1',
          sku: 'SKU1',
          name: 'Product 1',
          quantity: 5,
          unitCost: 10,
          lineTotal: 50,
        },
        {
          id: '2',
          poId: 'po1',
          productId: 'p2',
          sku: 'SKU2',
          name: 'Product 2',
          quantity: 3,
          unitCost: 20,
          lineTotal: 60,
        },
      ]

      expect(calculatePOSubtotal(lines)).toBe(110)
    })

    it('returns 0 for empty lines', () => {
      expect(calculatePOSubtotal([])).toBe(0)
    })
  })

  describe('findBestSupplier', () => {
    const product = { id: 'p1' }
    const supplier1: Supplier = {
      id: 's1',
      name: 'Supplier A',
      email: 'a@supplier.com',
      phone: '555-1111',
      address: '123 Main',
      leadTimeDays: 5,
      contactName: 'John',
      notes: '',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    }
    const supplier2: Supplier = {
      ...supplier1,
      id: 's2',
      name: 'Supplier B',
      email: 'b@supplier.com',
    }
    const suppliers = new Map([
      [supplier1.id, supplier1],
      [supplier2.id, supplier2],
    ])

    it('finds the cheapest supplier', () => {
      const supplierProducts: SupplierProduct[] = [
        {
          id: 'sp1',
          productId: 'p1',
          supplierId: 's1',
          unitCost: 15,
          minimumOrder: 10,
          notes: '',
          updatedAt: '2026-01-01T00:00:00Z',
        },
        {
          id: 'sp2',
          productId: 'p1',
          supplierId: 's2',
          unitCost: 10, // Cheapest
          minimumOrder: 5,
          notes: '',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ]

      const result = findBestSupplier(product, supplierProducts, suppliers)
      expect(result).toBeDefined()
      expect(result?.supplier.id).toBe('s2')
      expect(result?.product.unitCost).toBe(10)
    })

    it('returns undefined when no suppliers linked', () => {
      const result = findBestSupplier(product, [], suppliers)
      expect(result).toBeUndefined()
    })

    it('returns undefined when supplier not found', () => {
      const supplierProducts: SupplierProduct[] = [
        {
          id: 'sp1',
          productId: 'p1',
          supplierId: 's999', // Non-existent
          unitCost: 10,
          minimumOrder: 5,
          notes: '',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ]

      const result = findBestSupplier(product, supplierProducts, suppliers)
      expect(result).toBeUndefined()
    })
  })

  describe('productsNeedingReorder', () => {
    const products = [
      { id: 'p1', quantity: 2, reorderLevel: 5 }, // Below reorder
      { id: 'p2', quantity: 5, reorderLevel: 5 }, // At reorder
      { id: 'p3', quantity: 10, reorderLevel: 5 }, // Above reorder
      { id: 'p4', quantity: 0, reorderLevel: 0 }, // No reorder level
    ]

    const mockPO = (status: string, productIds: string[]): PurchaseOrder => ({
      id: `po-${status}`,
      supplierId: 's1',
      supplierName: 'Supplier',
      status: status as any,
      poNumber: `PO-${status}`,
      orderDate: '2026-01-01',
      expectedDeliveryDate: '2026-09-01',
      notes: '',
      lines: productIds.map((productId) => ({
        id: `line-${productId}`,
        poId: `po-${status}`,
        productId,
        sku: `SKU-${productId}`,
        name: `Product ${productId}`,
        quantity: 10,
        unitCost: 5,
        lineTotal: 50,
      })),
      subtotal: 50,
      deliveryCost: 0,
      buyersPremium: 0,
      vatAmount: 0,
      grandTotal: 50,
      createdAt: '2026-01-01T00:00:00Z',
    })

    it('identifies products below reorder level without pending POs', () => {
      const posByStatus = new Map<PurchaseOrderStatus, PurchaseOrder[]>()

      const result = productsNeedingReorder(products, [], posByStatus)
      expect(result).toHaveLength(2)
      expect(result.map((p) => p.id)).toEqual(['p1', 'p2'])
    })

    it('excludes products with pending/sent/confirmed POs', () => {
      const posByStatus = new Map<PurchaseOrderStatus, PurchaseOrder[]>([
        ['draft', [mockPO('draft', ['p1'])]],
        ['sent', [mockPO('sent', ['p2'])]],
        ['confirmed', [mockPO('confirmed', ['p1'])]],
      ])

      const result = productsNeedingReorder(products, [], posByStatus)
      expect(result).toHaveLength(0)
    })

    it('includes products with received POs (not on order anymore)', () => {
      const posByStatus = new Map<PurchaseOrderStatus, PurchaseOrder[]>([
        ['received', [mockPO('received', ['p1'])]],
      ])

      const result = productsNeedingReorder(products, [], posByStatus)
      expect(result).toHaveLength(2)
      expect(result.map((p) => p.id)).toEqual(['p1', 'p2'])
    })

    it('returns empty array when all products are above reorder', () => {
      const highStock = [
        { id: 'p1', quantity: 100, reorderLevel: 5 },
        { id: 'p2', quantity: 100, reorderLevel: 5 },
      ]

      const result = productsNeedingReorder(highStock, [], new Map<PurchaseOrderStatus, PurchaseOrder[]>())
      expect(result).toHaveLength(0)
    })

    it('ignores products with zero reorder level', () => {
      const mixed = [
        { id: 'p1', quantity: 0, reorderLevel: 0 },
        { id: 'p2', quantity: 2, reorderLevel: 5 },
      ]

      const result = productsNeedingReorder(mixed, [], new Map<PurchaseOrderStatus, PurchaseOrder[]>())
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('p2')
    })
  })
})

describe('calculatePoInvoiceTotals', () => {
  it('adds up an auction invoice: hammer + VAT per line, then delivery, premium and total VAT', () => {
    // e.g. 6x Braun ThermoScan 7 at £60 hammer (£12 VAT) plus a £10 lot (£2 VAT).
    const totals = calculatePoInvoiceTotals({
      lines: [
        { hammerPrice: 60, vatAmount: 12 },
        { hammerPrice: 10, vatAmount: 2 },
      ],
      deliveryCost: 15,
      buyersPremium: 17.5,
      totalVat: 17.5, // 14 on hammer + 3.50 on premium
    })
    expect(totals.netHammer).toBe(70)
    expect(totals.hammerVat).toBe(14)
    expect(totals.subtotal).toBe(84)
    expect(totals.premiumVat).toBe(3.5)
    expect(totals.grandTotal).toBe(120) // 70 + 15 + 17.50 + 17.50
  })

  it('falls back to the line VAT when total VAT is left blank', () => {
    const totals = calculatePoInvoiceTotals({ lines: [{ hammerPrice: 60, vatAmount: 12 }], deliveryCost: 0, buyersPremium: 0 })
    expect(totals.totalVat).toBe(12)
    expect(totals.grandTotal).toBe(72)
  })
})

describe('poLineCostPerItem', () => {
  it('splits hammer + VAT across the quantity, to the penny', () => {
    expect(poLineCostPerItem(60, 12, 6)).toBe(12)
    expect(poLineCostPerItem(10, 0, 3)).toBe(3.33)
    expect(poLineCostPerItem(10, 2, 0)).toBe(0)
  })
})

describe('true cost per item', () => {
  it('splits delivery, premium and VAT on premium evenly across every item', () => {
    // 6 thermometers (60 hammer, 12 VAT) + 2 kettles (20 hammer, 4 VAT).
    const totals = calculatePoInvoiceTotals({
      lines: [
        { hammerPrice: 60, vatAmount: 12, quantity: 6 },
        { hammerPrice: 20, vatAmount: 4, quantity: 2 },
      ],
      deliveryCost: 8,
      buyersPremium: 20,
      totalVat: 20, // 16 on hammer + 4 on premium
    })
    expect(totals.totalItems).toBe(8)
    expect(totals.overheadPerItem).toBe(4) // (8 + 20 + 4) / 8
    const thermo = poLineTrueCostPerItem(60, 12, 6, totals.overheadPerItem)
    const kettle = poLineTrueCostPerItem(20, 4, 2, totals.overheadPerItem)
    expect(thermo).toBe(16) // 12 + 4
    expect(kettle).toBe(16) // 12 + 4
    // Every item's true cost adds back up to the grand total.
    expect(thermo * 6 + kettle * 2).toBe(totals.grandTotal)
  })
})

describe('real John Pye invoice #576758734', () => {
  it('matches the invoice grand total of £142.18 and gives £23.70 per thermometer', () => {
    // Lots 242 and 238: 3x Braun ThermoScan 7 each, £43.00 hammer + £8.60 VAT.
    const totals = calculatePoInvoiceTotals({
      lines: [
        { hammerPrice: 43, vatAmount: 8.6, quantity: 3 },
        { hammerPrice: 43, vatAmount: 8.6, quantity: 3 },
      ],
      deliveryCost: 10.98,
      buyersPremium: 21.5,
      totalVat: 23.7, // includes VAT on premium (4.30) and delivery (2.20)
    })
    expect(totals.netHammer).toBe(86)
    expect(totals.grandTotal).toBe(142.18)
    expect(poLineTrueCostPerItem(43, 8.6, 3, totals.overheadPerItem)).toBe(23.7)
  })
})
