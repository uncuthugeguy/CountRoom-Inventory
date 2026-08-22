import type { Product, Sale, SaleFeesFields, StockMovement } from './types'

// ============================================================================
// REPORT FILTER TYPES
// ============================================================================

export interface DateRange {
  start: string // ISO date (YYYY-MM-DD)
  end: string // ISO date (YYYY-MM-DD)
}

export interface ReportFilters {
  dateRange: DateRange
  channel?: string
}

// ============================================================================
// SALES REPORT
// ============================================================================

export interface SalesMetrics {
  totalSales: number
  totalRevenue: number
  totalCost: number
  totalProfit: number
  averageOrderValue: number
  averageProfitPerOrder: number
  profitMargin: number // profit / revenue, as percentage (0-100)
  feesDeducted: number
  itemsUnitsSold: number
}

export interface ChannelMetrics extends SalesMetrics {
  channel: string
}

export interface SalesReport {
  period: DateRange
  overall: SalesMetrics
  byChannel: ChannelMetrics[]
  topProducts: {
    name: string
    sku: string
    unitsSold: number
    revenue: number
    profit: number
  }[]
  bottomProducts: {
    name: string
    sku: string
    unitsSold: number
    revenue: number
    profit: number
  }[]
}

// ============================================================================
// INVENTORY REPORT
// ============================================================================

export interface InventoryMetrics {
  totalProducts: number
  totalUnits: number
  outOfStock: number
  lowStock: number
  totalCostBasis: number // sum of (quantity * cost) for all products
  averageCostPerUnit: number
}

export interface CategoryMetrics {
  category: string
  productCount: number
  totalUnits: number
  outOfStock: number
  lowStock: number
  totalCostBasis: number
}

export interface InventoryReport {
  timestamp: string
  overall: InventoryMetrics
  byCategory: CategoryMetrics[]
  outOfStockProducts: {
    name: string
    sku: string
    category: string
    lastMovement?: string // ISO timestamp
  }[]
  lowStockProducts: {
    name: string
    sku: string
    category: string
    quantity: number
    reorderLevel: number
  }[]
}

// ============================================================================
// MOVEMENT REPORT
// ============================================================================

export interface MovementMetrics {
  totalStockIn: number
  totalStockOut: number
  totalAdjustments: number
  netMovement: number
}

export interface MovementType {
  type: 'in' | 'out' | 'adjust'
  count: number
  totalQuantity: number
}

export interface MovementReport {
  period: DateRange
  metrics: MovementMetrics
  byType: MovementType[]
  topProducts: {
    productId: string
    name: string
    sku: string
    inCount: number
    outCount: number
    netMovement: number
  }[]
}

// ============================================================================
// CALCULATION HELPERS
// ============================================================================

/** Checks if a sale falls within the date range. */
export function saleInDateRange(sale: Sale, range: DateRange): boolean {
  const saleDate = sale.createdAt.split('T')[0]
  return saleDate >= range.start && saleDate <= range.end
}

/** Checks if a movement falls within the date range. */
export function movementInDateRange(movement: StockMovement, range: DateRange): boolean {
  const movDate = movement.createdAt.split('T')[0]
  return movDate >= range.start && movDate <= range.end
}

/** Calculates total fees deducted from a sale (seller-paid only). */
export function calculateSellerPaidFees(fees: SaleFeesFields): number {
  let total = fees.vat ?? 0
  total += fees.advertisingCost ?? 0
  if ((fees.deliveryPaidBy ?? 'seller') === 'seller') {
    total += fees.deliveryCost ?? 0
  }
  if ((fees.buyerProtectionFeePaidBy ?? 'seller') === 'seller') {
    total += fees.buyerProtectionFee ?? 0
  }
  return total
}

/** Generate a sales report for the given date range and optional channel filter. */
export function generateSalesReport(sales: Sale[], filters: ReportFilters): SalesReport {
  const filtered = sales.filter(
    (s) =>
      saleInDateRange(s, filters.dateRange) &&
      (!filters.channel || s.channel === filters.channel),
  )

  if (filtered.length === 0) {
    return {
      period: filters.dateRange,
      overall: {
        totalSales: 0,
        totalRevenue: 0,
        totalCost: 0,
        totalProfit: 0,
        averageOrderValue: 0,
        averageProfitPerOrder: 0,
        profitMargin: 0,
        feesDeducted: 0,
        itemsUnitsSold: 0,
      },
      byChannel: [],
      topProducts: [],
      bottomProducts: [],
    }
  }

  // Overall metrics
  const totalRevenue = filtered.reduce((sum, s) => sum + s.subtotal, 0)
  const totalCost = filtered.reduce((sum, s) => sum + s.totalCost, 0)
  const totalProfit = filtered.reduce((sum, s) => sum + s.profit, 0)
  const feesDeducted = filtered.reduce((sum, s) => sum + calculateSellerPaidFees(s), 0)
  const itemsUnitsSold = filtered.reduce((sum, s) => sum + s.lines.reduce((lineSum, l) => lineSum + l.quantity, 0), 0)

  const overall: SalesMetrics = {
    totalSales: filtered.length,
    totalRevenue,
    totalCost,
    totalProfit,
    averageOrderValue: totalRevenue / filtered.length,
    averageProfitPerOrder: totalProfit / filtered.length,
    profitMargin: totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0,
    feesDeducted,
    itemsUnitsSold,
  }

  // Group by channel
  const byChannel = Array.from(
    filtered.reduce((map, sale) => {
      if (!map.has(sale.channel)) {
        map.set(sale.channel, [])
      }
      map.get(sale.channel)!.push(sale)
      return map
    }, new Map<string, Sale[]>()),
  ).map(([channel, channelSales]): ChannelMetrics => {
    const channelRevenue = channelSales.reduce((sum, s) => sum + s.subtotal, 0)
    const channelCost = channelSales.reduce((sum, s) => sum + s.totalCost, 0)
    const channelProfit = channelSales.reduce((sum, s) => sum + s.profit, 0)
    const channelFees = channelSales.reduce((sum, s) => sum + calculateSellerPaidFees(s), 0)
    const channelUnits = channelSales.reduce((sum, s) => sum + s.lines.reduce((lineSum, l) => lineSum + l.quantity, 0), 0)

    return {
      channel,
      totalSales: channelSales.length,
      totalRevenue: channelRevenue,
      totalCost: channelCost,
      totalProfit: channelProfit,
      averageOrderValue: channelRevenue / channelSales.length,
      averageProfitPerOrder: channelProfit / channelSales.length,
      profitMargin: channelRevenue > 0 ? (channelProfit / channelRevenue) * 100 : 0,
      feesDeducted: channelFees,
      itemsUnitsSold: channelUnits,
    }
  })

  // Aggregate by product
  const productMetrics = new Map<
    string,
    {
      name: string
      sku: string
      unitsSold: number
      revenue: number
      profit: number
    }
  >()

  for (const sale of filtered) {
    for (const line of sale.lines) {
      const key = line.productId
      const existing = productMetrics.get(key) || {
        name: line.name,
        sku: line.sku,
        unitsSold: 0,
        revenue: 0,
        profit: 0,
      }
      existing.unitsSold += line.quantity
      existing.revenue += line.lineTotal
      existing.profit += line.lineProfit
      productMetrics.set(key, existing)
    }
  }

  const products = Array.from(productMetrics.values())
  const topProducts = products
    .sort((a, b) => b.profit - a.profit)
    .slice(0, 5)
  const bottomProducts = products
    .sort((a, b) => a.profit - b.profit)
    .slice(0, 5)

  return {
    period: filters.dateRange,
    overall,
    byChannel: byChannel.sort((a, b) => b.totalProfit - a.totalProfit),
    topProducts,
    bottomProducts,
  }
}

/** Generate an inventory report as of now. */
export function generateInventoryReport(
  products: Product[],
  movements: StockMovement[],
): InventoryReport {
  const outOfStockProducts = products.filter((p) => p.quantity === 0)
  const lowStockProducts = products.filter(
    (p) => p.reorderLevel > 0 && p.quantity > 0 && p.quantity <= p.reorderLevel,
  )

  const totalCostBasis = products.reduce((sum, p) => sum + p.quantity * p.cost, 0)
  const totalUnits = products.reduce((sum, p) => sum + p.quantity, 0)

  const byCategory = Array.from(
    products.reduce((map, product) => {
      if (!map.has(product.category)) {
        map.set(product.category, [])
      }
      map.get(product.category)!.push(product)
      return map
    }, new Map<string, Product[]>()),
  ).map(([category, catProducts]): CategoryMetrics => {
    const catCostBasis = catProducts.reduce((sum, p) => sum + p.quantity * p.cost, 0)
    const catUnits = catProducts.reduce((sum, p) => sum + p.quantity, 0)
    const catOutOfStock = catProducts.filter((p) => p.quantity === 0).length
    const catLowStock = catProducts.filter(
      (p) => p.reorderLevel > 0 && p.quantity > 0 && p.quantity <= p.reorderLevel,
    ).length

    return {
      category,
      productCount: catProducts.length,
      totalUnits: catUnits,
      outOfStock: catOutOfStock,
      lowStock: catLowStock,
      totalCostBasis: catCostBasis,
    }
  })

  // Last movement date for each product
  const lastMovementByProduct = new Map<string, string>()
  for (const movement of movements) {
    const existing = lastMovementByProduct.get(movement.productId)
    if (!existing || movement.createdAt > existing) {
      lastMovementByProduct.set(movement.productId, movement.createdAt)
    }
  }

  return {
    timestamp: new Date().toISOString(),
    overall: {
      totalProducts: products.length,
      totalUnits,
      outOfStock: outOfStockProducts.length,
      lowStock: lowStockProducts.length,
      totalCostBasis,
      averageCostPerUnit: totalUnits > 0 ? totalCostBasis / totalUnits : 0,
    },
    byCategory: byCategory.sort((a, b) => b.totalUnits - a.totalUnits),
    outOfStockProducts: outOfStockProducts.map((p) => ({
      name: p.name,
      sku: p.sku,
      category: p.category,
      lastMovement: lastMovementByProduct.get(p.id),
    })),
    lowStockProducts: lowStockProducts.map((p) => ({
      name: p.name,
      sku: p.sku,
      category: p.category,
      quantity: p.quantity,
      reorderLevel: p.reorderLevel,
    })),
  }
}

/** Generate a movement report for the given date range. `products` is used
 * to look up each line's real name/sku — a movement only ever stores a bare
 * `productId`, the same reasoning `generateInventoryReport`'s last-movement
 * lookup needs both movements and products passed in together. A product
 * that's since been deleted still shows up (its movement history shouldn't
 * vanish), labelled the same way History's own list already does. */
export function generateMovementReport(
  movements: StockMovement[],
  filters: ReportFilters,
  products: Product[],
): MovementReport {
  const filtered = movements.filter((m) => movementInDateRange(m, filters.dateRange))
  const productById = new Map(products.map((p) => [p.id, p]))

  const byType = [
    {
      type: 'in' as const,
      movements: filtered.filter((m) => m.type === 'in'),
    },
    {
      type: 'out' as const,
      movements: filtered.filter((m) => m.type === 'out'),
    },
    {
      type: 'adjust' as const,
      movements: filtered.filter((m) => m.type === 'adjust'),
    },
  ]

  const topProducts = Array.from(
    filtered.reduce((map, movement) => {
      if (!map.has(movement.productId)) {
        map.set(movement.productId, { inCount: 0, outCount: 0, netMovement: 0 })
      }
      const stats = map.get(movement.productId)!
      if (movement.type === 'in') stats.inCount++
      if (movement.type === 'out') stats.outCount++
      stats.netMovement += movement.delta
      return map
    }, new Map<string, { inCount: number; outCount: number; netMovement: number }>()),
  )
    .map(([productId, stats]) => {
      const product = productById.get(productId)
      return {
        productId,
        name: product?.name ?? 'Deleted product',
        sku: product?.sku ?? '—',
        ...stats,
      }
    })
    .sort((a, b) => Math.abs(b.netMovement) - Math.abs(a.netMovement))
    .slice(0, 10)

  return {
    period: filters.dateRange,
    metrics: {
      totalStockIn: byType[0].movements.reduce((sum, m) => sum + m.quantity, 0),
      totalStockOut: byType[1].movements.reduce((sum, m) => sum + m.quantity, 0),
      totalAdjustments: byType[2].movements.length,
      netMovement: filtered.reduce((sum, m) => sum + m.delta, 0),
    },
    byType: byType.map((t) => ({
      type: t.type,
      count: t.movements.length,
      totalQuantity: t.movements.reduce((sum, m) => sum + Math.abs(m.delta), 0),
    })),
    topProducts,
  }
}
