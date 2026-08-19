import { describe, it, expect } from 'vitest'
import {
  poLineTotal,
  calculatePOSubtotal,
  findBestSupplier,
  productsNeedingReorder,
} from './suppliers'
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
