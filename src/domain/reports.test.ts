import { describe, it, expect } from 'vitest'
import {
  calculateSellerPaidFees,
  generateSalesReport,
  generateInventoryReport,
  generateMovementReport,
  saleInDateRange,
  movementInDateRange,
} from './reports'
import type { Sale, Product, StockMovement } from './types'

describe('Reporting', () => {
  describe('calculateSellerPaidFees', () => {
    it('includes seller-paid delivery', () => {
      const fees = {
        deliveryCost: 5,
        deliveryPaidBy: 'seller' as const,
        vat: 2,
        advertisingCost: 1,
      }
      expect(calculateSellerPaidFees(fees)).toBe(8)
    })

    it('excludes buyer-paid delivery', () => {
      const fees = {
        deliveryCost: 5,
        deliveryPaidBy: 'buyer' as const,
        vat: 2,
        advertisingCost: 1,
      }
      expect(calculateSellerPaidFees(fees)).toBe(3)
    })

    it('includes seller-paid buyer protection fee', () => {
      const fees = {
        buyerProtectionFee: 3,
        buyerProtectionFeePaidBy: 'seller' as const,
        vat: 2,
        advertisingCost: 1,
      }
      expect(calculateSellerPaidFees(fees)).toBe(6)
    })

    it('defaults to seller-paid when not specified', () => {
      const fees = {
        deliveryCost: 5,
        vat: 2,
      }
      expect(calculateSellerPaidFees(fees)).toBe(7)
    })
  })

  describe('dateRange filtering', () => {
    const range = { start: '2026-01-15', end: '2026-01-20' }

    it('saleInDateRange includes boundaries', () => {
      const startSale: Sale = {
        id: '1',
        channel: 'Test',
        paymentMethod: 'cash',
        subtotal: 100,
        totalCost: 50,
        profit: 50,
        createdAt: '2026-01-15T10:00:00Z',
        lines: [],
      }
      const endSale: Sale = {
        ...startSale,
        id: '2',
        createdAt: '2026-01-20T23:59:59Z',
      }
      const beforeSale: Sale = {
        ...startSale,
        id: '3',
        createdAt: '2026-01-14T23:59:59Z',
      }
      const afterSale: Sale = {
        ...startSale,
        id: '4',
        createdAt: '2026-01-21T00:00:00Z',
      }

      expect(saleInDateRange(startSale, range)).toBe(true)
      expect(saleInDateRange(endSale, range)).toBe(true)
      expect(saleInDateRange(beforeSale, range)).toBe(false)
      expect(saleInDateRange(afterSale, range)).toBe(false)
    })

    it('movementInDateRange works correctly', () => {
      const movement: StockMovement = {
        id: '1',
        productId: 'p1',
        type: 'in',
        quantity: 10,
        delta: 10,
        previousQuantity: 0,
        newQuantity: 10,
        createdAt: '2026-01-17T10:00:00Z',
      }
      expect(movementInDateRange(movement, range)).toBe(true)

      const before = { ...movement, createdAt: '2026-01-14T10:00:00Z' }
      expect(movementInDateRange(before, range)).toBe(false)
    })
  })

  describe('generateSalesReport', () => {
    it('returns empty report when no sales match filters', () => {
      const range = { start: '2026-01-15', end: '2026-01-20' }
      const report = generateSalesReport([], { dateRange: range })

      expect(report.overall.totalSales).toBe(0)
      expect(report.overall.totalRevenue).toBe(0)
      expect(report.overall.totalProfit).toBe(0)
      expect(report.byChannel).toHaveLength(0)
    })

    it('calculates overall metrics correctly', () => {
      const range = { start: '2026-01-15', end: '2026-01-20' }
      const sales: Sale[] = [
        {
          id: '1',
          channel: 'eBay',
          paymentMethod: 'card',
          subtotal: 100,
          totalCost: 60,
          profit: 40,
          createdAt: '2026-01-17T10:00:00Z',
          vat: 0,
          deliveryCost: 0,
          advertisingCost: 0,
          lines: [
            {
              id: 'l1',
              saleId: '1',
              productId: 'p1',
              sku: 'SKU1',
              name: 'Product 1',
              quantity: 2,
              unitPrice: 50,
              unitCost: 30,
              lineTotal: 100,
              lineProfit: 40,
            },
          ],
        },
        {
          id: '2',
          channel: 'eBay',
          paymentMethod: 'cash',
          subtotal: 200,
          totalCost: 100,
          profit: 100,
          createdAt: '2026-01-18T10:00:00Z',
          vat: 0,
          deliveryCost: 0,
          advertisingCost: 0,
          lines: [
            {
              id: 'l2',
              saleId: '2',
              productId: 'p2',
              sku: 'SKU2',
              name: 'Product 2',
              quantity: 1,
              unitPrice: 200,
              unitCost: 100,
              lineTotal: 200,
              lineProfit: 100,
            },
          ],
        },
      ]

      const report = generateSalesReport(sales, { dateRange: range })

      expect(report.overall.totalSales).toBe(2)
      expect(report.overall.totalRevenue).toBe(300)
      expect(report.overall.totalCost).toBe(160)
      expect(report.overall.totalProfit).toBe(140)
      expect(report.overall.averageOrderValue).toBe(150)
      expect(report.overall.averageProfitPerOrder).toBe(70)
      expect(report.overall.profitMargin).toBeCloseTo(46.67, 1)
      expect(report.overall.itemsUnitsSold).toBe(3)
    })

    it('groups sales by channel', () => {
      const range = { start: '2026-01-15', end: '2026-01-20' }
      const sales: Sale[] = [
        {
          id: '1',
          channel: 'eBay',
          paymentMethod: 'card',
          subtotal: 100,
          totalCost: 50,
          profit: 50,
          createdAt: '2026-01-17T10:00:00Z',
          vat: 0,
          deliveryCost: 0,
          advertisingCost: 0,
          lines: [
            {
              id: 'l1',
              saleId: '1',
              productId: 'p1',
              sku: 'SKU1',
              name: 'Product 1',
              quantity: 1,
              unitPrice: 100,
              unitCost: 50,
              lineTotal: 100,
              lineProfit: 50,
            },
          ],
        },
        {
          id: '2',
          channel: 'Vinted',
          paymentMethod: 'card',
          subtotal: 50,
          totalCost: 25,
          profit: 25,
          createdAt: '2026-01-18T10:00:00Z',
          vat: 0,
          deliveryCost: 0,
          advertisingCost: 0,
          lines: [
            {
              id: 'l2',
              saleId: '2',
              productId: 'p2',
              sku: 'SKU2',
              name: 'Product 2',
              quantity: 1,
              unitPrice: 50,
              unitCost: 25,
              lineTotal: 50,
              lineProfit: 25,
            },
          ],
        },
      ]

      const report = generateSalesReport(sales, { dateRange: range })

      expect(report.byChannel).toHaveLength(2)
      expect(report.byChannel[0].channel).toBe('eBay')
      expect(report.byChannel[0].totalProfit).toBe(50)
      expect(report.byChannel[1].channel).toBe('Vinted')
      expect(report.byChannel[1].totalProfit).toBe(25)
    })

    it('filters by channel when specified', () => {
      const range = { start: '2026-01-15', end: '2026-01-20' }
      const sales: Sale[] = [
        {
          id: '1',
          channel: 'eBay',
          paymentMethod: 'card',
          subtotal: 100,
          totalCost: 50,
          profit: 50,
          createdAt: '2026-01-17T10:00:00Z',
          vat: 0,
          deliveryCost: 0,
          advertisingCost: 0,
          lines: [
            {
              id: 'l1',
              saleId: '1',
              productId: 'p1',
              sku: 'SKU1',
              name: 'Product 1',
              quantity: 1,
              unitPrice: 100,
              unitCost: 50,
              lineTotal: 100,
              lineProfit: 50,
            },
          ],
        },
        {
          id: '2',
          channel: 'Vinted',
          paymentMethod: 'card',
          subtotal: 50,
          totalCost: 25,
          profit: 25,
          createdAt: '2026-01-18T10:00:00Z',
          vat: 0,
          deliveryCost: 0,
          advertisingCost: 0,
          lines: [
            {
              id: 'l2',
              saleId: '2',
              productId: 'p2',
              sku: 'SKU2',
              name: 'Product 2',
              quantity: 1,
              unitPrice: 50,
              unitCost: 25,
              lineTotal: 50,
              lineProfit: 25,
            },
          ],
        },
      ]

      const report = generateSalesReport(sales, {
        dateRange: range,
        channel: 'eBay',
      })

      expect(report.overall.totalSales).toBe(1)
      expect(report.overall.totalProfit).toBe(50)
      expect(report.byChannel).toHaveLength(1)
    })

    it('identifies top and bottom products by profit', () => {
      const range = { start: '2026-01-15', end: '2026-01-20' }
      const sales: Sale[] = [
        {
          id: '1',
          channel: 'eBay',
          paymentMethod: 'card',
          subtotal: 100,
          totalCost: 50,
          profit: 50,
          createdAt: '2026-01-17T10:00:00Z',
          vat: 0,
          deliveryCost: 0,
          advertisingCost: 0,
          lines: [
            {
              id: 'l1',
              saleId: '1',
              productId: 'p1',
              sku: 'SKU1',
              name: 'High Margin',
              quantity: 1,
              unitPrice: 100,
              unitCost: 50,
              lineTotal: 100,
              lineProfit: 50,
            },
          ],
        },
        {
          id: '2',
          channel: 'eBay',
          paymentMethod: 'card',
          subtotal: 50,
          totalCost: 40,
          profit: 10,
          createdAt: '2026-01-18T10:00:00Z',
          vat: 0,
          deliveryCost: 0,
          advertisingCost: 0,
          lines: [
            {
              id: 'l2',
              saleId: '2',
              productId: 'p2',
              sku: 'SKU2',
              name: 'Low Margin',
              quantity: 1,
              unitPrice: 50,
              unitCost: 40,
              lineTotal: 50,
              lineProfit: 10,
            },
          ],
        },
      ]

      const report = generateSalesReport(sales, { dateRange: range })

      expect(report.topProducts[0].name).toBe('High Margin')
      expect(report.topProducts[0].profit).toBe(50)
      expect(report.bottomProducts[0].name).toBe('Low Margin')
      expect(report.bottomProducts[0].profit).toBe(10)
    })
  })

  describe('generateInventoryReport', () => {
    it('calculates inventory metrics correctly', () => {
      const products: Product[] = [
        {
          id: 'p1',
          barcode: 'BAR1',
          sku: 'SKU1',
          name: 'Product 1',
          category: 'Electronics',
          location: 'Shelf A',
          variation: '',
          quantity: 10,
          reorderLevel: 5,
          cost: 20,
          price: 50,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
        {
          id: 'p2',
          barcode: 'BAR2',
          sku: 'SKU2',
          name: 'Product 2',
          category: 'Electronics',
          location: 'Shelf B',
          variation: '',
          quantity: 0,
          reorderLevel: 5,
          cost: 15,
          price: 40,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
        {
          id: 'p3',
          barcode: 'BAR3',
          sku: 'SKU3',
          name: 'Product 3',
          category: 'Clothing',
          location: 'Rack C',
          variation: '',
          quantity: 3,
          reorderLevel: 5,
          cost: 10,
          price: 30,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ]

      const report = generateInventoryReport(products, [])

      expect(report.overall.totalProducts).toBe(3)
      expect(report.overall.totalUnits).toBe(13)
      expect(report.overall.outOfStock).toBe(1)
      expect(report.overall.lowStock).toBe(1) // p3 has 3 units, reorder level 5
      expect(report.overall.totalCostBasis).toBe(10 * 20 + 0 * 15 + 3 * 10)
      expect(report.overall.averageCostPerUnit).toBeCloseTo(17.69, 1)
    })

    it('groups inventory by category', () => {
      const products: Product[] = [
        {
          id: 'p1',
          barcode: '',
          sku: 'SKU1',
          name: 'Product 1',
          category: 'Electronics',
          location: '',
          variation: '',
          quantity: 10,
          reorderLevel: 0,
          cost: 20,
          price: 50,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
        {
          id: 'p2',
          barcode: '',
          sku: 'SKU2',
          name: 'Product 2',
          category: 'Clothing',
          location: '',
          variation: '',
          quantity: 5,
          reorderLevel: 0,
          cost: 15,
          price: 40,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ]

      const report = generateInventoryReport(products, [])

      expect(report.byCategory).toHaveLength(2)
      const electronics = report.byCategory.find((c) => c.category === 'Electronics')
      const clothing = report.byCategory.find((c) => c.category === 'Clothing')

      expect(electronics?.productCount).toBe(1)
      expect(electronics?.totalUnits).toBe(10)
      expect(clothing?.productCount).toBe(1)
      expect(clothing?.totalUnits).toBe(5)
    })

    it('identifies out-of-stock and low-stock products', () => {
      const products: Product[] = [
        {
          id: 'p1',
          barcode: '',
          sku: 'SKU1',
          name: 'Out of Stock',
          category: 'Test',
          location: '',
          variation: '',
          quantity: 0,
          reorderLevel: 5,
          cost: 10,
          price: 20,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
        {
          id: 'p2',
          barcode: '',
          sku: 'SKU2',
          name: 'Low Stock',
          category: 'Test',
          location: '',
          variation: '',
          quantity: 2,
          reorderLevel: 5,
          cost: 10,
          price: 20,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ]

      const report = generateInventoryReport(products, [])

      expect(report.outOfStockProducts).toHaveLength(1)
      expect(report.outOfStockProducts[0].name).toBe('Out of Stock')

      expect(report.lowStockProducts).toHaveLength(1)
      expect(report.lowStockProducts[0].name).toBe('Low Stock')
    })
  })

  describe('generateMovementReport', () => {
    it('categorizes movements by type', () => {
      const range = { start: '2026-01-15', end: '2026-01-20' }
      const movements: StockMovement[] = [
        {
          id: '1',
          productId: 'p1',
          type: 'in',
          quantity: 10,
          delta: 10,
          previousQuantity: 0,
          newQuantity: 10,
          createdAt: '2026-01-17T10:00:00Z',
        },
        {
          id: '2',
          productId: 'p1',
          type: 'out',
          quantity: 3,
          delta: -3,
          previousQuantity: 10,
          newQuantity: 7,
          createdAt: '2026-01-18T10:00:00Z',
        },
        {
          id: '3',
          productId: 'p2',
          type: 'adjust',
          quantity: 5,
          delta: 5,
          previousQuantity: 0,
          newQuantity: 5,
          createdAt: '2026-01-19T10:00:00Z',
        },
      ]

      const report = generateMovementReport(movements, { dateRange: range })

      expect(report.metrics.totalStockIn).toBe(10)
      expect(report.metrics.totalStockOut).toBe(3)
      expect(report.metrics.totalAdjustments).toBe(1)
      expect(report.metrics.netMovement).toBe(12)

      const inType = report.byType.find((t) => t.type === 'in')
      const outType = report.byType.find((t) => t.type === 'out')
      const adjustType = report.byType.find((t) => t.type === 'adjust')

      expect(inType?.count).toBe(1)
      expect(outType?.count).toBe(1)
      expect(adjustType?.count).toBe(1)
    })

    it('filters movements by date range', () => {
      const range = { start: '2026-01-17', end: '2026-01-18' }
      const movements: StockMovement[] = [
        {
          id: '1',
          productId: 'p1',
          type: 'in',
          quantity: 10,
          delta: 10,
          previousQuantity: 0,
          newQuantity: 10,
          createdAt: '2026-01-16T10:00:00Z',
        },
        {
          id: '2',
          productId: 'p1',
          type: 'in',
          quantity: 5,
          delta: 5,
          previousQuantity: 10,
          newQuantity: 15,
          createdAt: '2026-01-17T10:00:00Z',
        },
        {
          id: '3',
          productId: 'p1',
          type: 'out',
          quantity: 3,
          delta: -3,
          previousQuantity: 15,
          newQuantity: 12,
          createdAt: '2026-01-19T10:00:00Z',
        },
      ]

      const report = generateMovementReport(movements, { dateRange: range })

      expect(report.metrics.totalStockIn).toBe(5)
      expect(report.metrics.totalStockOut).toBe(0)
      expect(report.metrics.netMovement).toBe(5)
    })
  })
})
