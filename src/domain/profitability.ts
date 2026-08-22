import type { Product, Sale } from './types'

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * A `reports.ts`-compatible `DateRange` covering the last `days` days up to
 * and including today — for feeding `generateSalesReport` a rolling "how
 * are my products doing lately" window (what the Dashboard uses) rather
 * than a fixed historical period a manager has to pick by hand. `now`
 * defaults to the real clock but is a parameter so callers/tests can pin it.
 */
export function rollingDateRange(days: number, now: Date = new Date()): { start: string; end: string } {
  const end = now.toISOString().split('T')[0]
  const start = new Date(now.getTime() - days * MS_PER_DAY).toISOString().split('T')[0]
  return { start, end }
}

export interface DeadStockEntry {
  productId: string
  sku: string
  name: string
  category: string
  quantity: number
  /** Cash tied up in this line's unsold stock — quantity × unit cost. */
  costBasis: number
  /** Null if this product has never recorded a sale at all. */
  lastSoldAt: string | null
  /** Null alongside `lastSoldAt` — otherwise whole days since the last sale. */
  daysSinceLastSale: number | null
}

/** Most recent sale date for every product that has ever sold, from the
 * *full* sale history — deliberately not scoped to any reporting window,
 * since "when did this last sell" is a different question from "how did it
 * do in the last N days" (`reports.ts`'s job, and `rollingDateRange` above
 * feeds it). */
function lastSaleDateByProduct(sales: Sale[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const sale of sales) {
    for (const line of sale.lines) {
      const current = map.get(line.productId)
      if (!current || sale.createdAt > current) map.set(line.productId, sale.createdAt)
    }
  }
  return map
}

/**
 * Products sitting on the shelf with real stock — and real cash — tied up
 * in them, but no sale in a long time. `alerts.ts`'s low-stock alerts flag
 * the opposite problem (running out); this is deliberately the mirror of
 * that, so a manager sees both "reorder this" and "stop reordering this,
 * sell it through" from the same place — the "which products should I
 * buy/sell" question the app is meant to answer, not just a stock count.
 *
 * A product that has genuinely never sold isn't flagged just because it's
 * new — `product.createdAt` is checked against the same threshold so a line
 * added yesterday gets a fair chance to sell before showing up here.
 *
 * Ordered by cost tied up (most first): a slow-moving £2 item is a shrug, a
 * slow-moving £200 item is real money sitting on a shelf, so that's the
 * number that should decide what a manager looks at first.
 */
export function findDeadStock(
  products: Product[],
  sales: Sale[],
  now: Date,
  minDaysSinceLastSale = 60,
): DeadStockEntry[] {
  const lastSaleByProduct = lastSaleDateByProduct(sales)
  const entries: DeadStockEntry[] = []

  for (const product of products) {
    if (product.quantity <= 0) continue

    const lastSoldAt = lastSaleByProduct.get(product.id) ?? null
    const daysSinceLastSale = lastSoldAt
      ? Math.floor((now.getTime() - new Date(lastSoldAt).getTime()) / MS_PER_DAY)
      : null

    const isDead =
      daysSinceLastSale !== null
        ? daysSinceLastSale >= minDaysSinceLastSale
        : Math.floor((now.getTime() - new Date(product.createdAt).getTime()) / MS_PER_DAY) >= minDaysSinceLastSale
    if (!isDead) continue

    entries.push({
      productId: product.id,
      sku: product.sku,
      name: product.name,
      category: product.category,
      quantity: product.quantity,
      costBasis: product.quantity * product.cost,
      lastSoldAt,
      daysSinceLastSale,
    })
  }

  return entries.sort((a, b) => b.costBasis - a.costBasis)
}
