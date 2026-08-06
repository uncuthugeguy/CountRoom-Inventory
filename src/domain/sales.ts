import type { PaymentMethod, Product, Sale, SaleInput } from './types'

/** One line of a sale in progress — not yet submitted to the repository. */
export interface CartLine {
  product: Product
  quantity: number
  /** Defaults to the product's price but can be overridden per sale. */
  unitPrice: number
}

export type Cart = CartLine[]

export const emptyCart = (): Cart => []

/** Adds one unit of a product, or increments the existing line if it's already in the cart. */
export function addToCart(cart: Cart, product: Product): Cart {
  const existing = cart.find((line) => line.product.id === product.id)
  if (existing) {
    return cart.map((line) =>
      line.product.id === product.id ? { ...line, quantity: line.quantity + 1 } : line,
    )
  }
  return [...cart, { product, quantity: 1, unitPrice: product.price }]
}

export function removeFromCart(cart: Cart, productId: string): Cart {
  return cart.filter((line) => line.product.id !== productId)
}

/** A quantity of zero or less removes the line entirely. */
export function setCartQuantity(cart: Cart, productId: string, quantity: number): Cart {
  if (quantity <= 0) return removeFromCart(cart, productId)
  return cart.map((line) => (line.product.id === productId ? { ...line, quantity } : line))
}

export function setCartPrice(cart: Cart, productId: string, unitPrice: number): Cart {
  return cart.map((line) => (line.product.id === productId ? { ...line, unitPrice } : line))
}

export interface CartTotals {
  itemCount: number
  subtotal: number
  totalCost: number
  profit: number
}

export function cartTotals(cart: Cart): CartTotals {
  return cart.reduce<CartTotals>(
    (totals, line) => ({
      itemCount: totals.itemCount + line.quantity,
      subtotal: totals.subtotal + line.unitPrice * line.quantity,
      totalCost: totals.totalCost + line.product.cost * line.quantity,
      profit: totals.profit + (line.unitPrice - line.product.cost) * line.quantity,
    }),
    { itemCount: 0, subtotal: 0, totalCost: 0, profit: 0 },
  )
}

/** A line oversells when the cart wants more than is currently on hand. */
export function cartLineIssue(line: CartLine): string | null {
  if (line.quantity > line.product.quantity) {
    return `Only ${line.product.quantity} in stock.`
  }
  return null
}

export function cartHasIssues(cart: Cart): boolean {
  return cart.some((line) => cartLineIssue(line) !== null)
}

export function buildSaleInput(
  cart: Cart,
  channel: string,
  paymentMethod: PaymentMethod,
): SaleInput {
  return {
    channel: channel.trim(),
    paymentMethod,
    lines: cart.map((line) => ({
      productId: line.product.id,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
    })),
  }
}

export interface SalesSummary {
  saleCount: number
  itemsSold: number
  revenue: number
  cost: number
  profit: number
}

const EMPTY_SUMMARY: SalesSummary = { saleCount: 0, itemsSold: 0, revenue: 0, cost: 0, profit: 0 }

export function summariseSales(sales: Sale[]): SalesSummary {
  return sales.reduce<SalesSummary>(
    (totals, sale) => ({
      saleCount: totals.saleCount + 1,
      itemsSold: totals.itemsSold + sale.lines.reduce((n, line) => n + line.quantity, 0),
      revenue: totals.revenue + sale.subtotal,
      cost: totals.cost + sale.totalCost,
      profit: totals.profit + sale.profit,
    }),
    { ...EMPTY_SUMMARY },
  )
}

/** Sales at or after the given instant, inclusive. */
export function salesSince(sales: Sale[], since: Date): Sale[] {
  const cutoff = since.getTime()
  return sales.filter((sale) => new Date(sale.createdAt).getTime() >= cutoff)
}

export interface SalesBreakdownRow {
  key: string
  count: number
  revenue: number
  profit: number
}

function breakdownBy(sales: Sale[], keyOf: (sale: Sale) => string): SalesBreakdownRow[] {
  const rows = new Map<string, SalesBreakdownRow>()
  for (const sale of sales) {
    const key = keyOf(sale) || 'Unspecified'
    const row = rows.get(key) ?? { key, count: 0, revenue: 0, profit: 0 }
    row.count += 1
    row.revenue += sale.subtotal
    row.profit += sale.profit
    rows.set(key, row)
  }
  return [...rows.values()].sort((a, b) => b.revenue - a.revenue)
}

export function breakdownByChannel(sales: Sale[]): SalesBreakdownRow[] {
  return breakdownBy(sales, (sale) => sale.channel)
}

export function breakdownByPaymentMethod(sales: Sale[]): SalesBreakdownRow[] {
  return breakdownBy(sales, (sale) => sale.paymentMethod)
}

export interface ProductBreakdownRow {
  name: string
  sku: string
  unitsSold: number
  revenue: number
  profit: number
}

/**
 * Per-product sales, so it's obvious which lines are actually moving and
 * which aren't — grouped by SKU (stable even if the product is later
 * renamed or deleted) rather than product id.
 */
export function breakdownByProduct(sales: Sale[]): ProductBreakdownRow[] {
  const rows = new Map<string, ProductBreakdownRow>()
  for (const sale of sales) {
    for (const line of sale.lines) {
      const key = line.sku || line.name
      const row = rows.get(key) ?? { name: line.name, sku: line.sku, unitsSold: 0, revenue: 0, profit: 0 }
      row.unitsSold += line.quantity
      row.revenue += line.lineTotal
      row.profit += line.lineProfit
      rows.set(key, row)
    }
  }
  return [...rows.values()].sort((a, b) => b.unitsSold - a.unitsSold)
}
