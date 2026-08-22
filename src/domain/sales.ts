import type { PaidBy, PaymentMethod, Product, Sale, SaleInput } from './types'

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

/** Order-level marketplace fees, as free-text form state — a blank field
 * reads as "not entered" rather than as a hard zero, so a form can start
 * empty without every field showing a misleading `0.00`. */
export interface SaleFeesDraft {
  buyerProtectionFee: string
  /** Who actually paid the buyer protection fee — same seller/buyer choice
   * as `deliveryPaidBy`. */
  buyerProtectionFeePaidBy: PaidBy
  deliveryCost: string
  deliveryPaidBy: PaidBy
  vat: string
  advertisingCost: string
  /** The buyer's total from the marketplace's own order summary — a
   * reconciliation figure only, not part of the profit calculation. */
  orderTotal: string
}

export const EMPTY_SALE_FEES_DRAFT: SaleFeesDraft = {
  buyerProtectionFee: '',
  buyerProtectionFeePaidBy: 'seller',
  deliveryCost: '',
  deliveryPaidBy: 'seller',
  vat: '',
  advertisingCost: '',
  orderTotal: '',
}

/** A `SaleFeesDraft`'s fields, resolved down to concrete numbers/choices —
 * what actually gets sent to a repository and what profit math runs against.
 * A blank amount resolves to 0; a blank order total resolves to `null`
 * ("not entered") rather than 0, since 0 would be a real (if unusual) value. */
export interface ResolvedSaleFees {
  buyerProtectionFee: number
  buyerProtectionFeePaidBy: PaidBy
  deliveryCost: number
  deliveryPaidBy: PaidBy
  vat: number
  advertisingCost: number
  orderTotal: number | null
}

const parseAmount = (raw: string): number => {
  const n = Number(raw)
  return raw.trim() !== '' && Number.isFinite(n) ? n : 0
}

export function resolveSaleFeesDraft(draft: SaleFeesDraft): ResolvedSaleFees {
  const orderTotalRaw = Number(draft.orderTotal)
  const orderTotal = draft.orderTotal.trim() !== '' && Number.isFinite(orderTotalRaw) ? orderTotalRaw : null
  return {
    buyerProtectionFee: parseAmount(draft.buyerProtectionFee),
    buyerProtectionFeePaidBy: draft.buyerProtectionFeePaidBy,
    deliveryCost: parseAmount(draft.deliveryCost),
    deliveryPaidBy: draft.deliveryPaidBy,
    vat: parseAmount(draft.vat),
    advertisingCost: parseAmount(draft.advertisingCost),
    orderTotal,
  }
}

/** Rebuilds an editable fees draft from a previously recorded sale, the
 * `SaleFeesDraft` counterpart to `buildEditCart` below — a missing/zero
 * amount is shown as a blank field rather than a literal "0", matching how
 * the field looked before anything was typed into it. */
export function saleFeesDraftFromSale(sale: Pick<Sale, 'buyerProtectionFee' | 'buyerProtectionFeePaidBy' | 'deliveryCost' | 'deliveryPaidBy' | 'vat' | 'advertisingCost' | 'orderTotal'>): SaleFeesDraft {
  const str = (n: number | undefined): string => (n ? String(n) : '')
  return {
    buyerProtectionFee: str(sale.buyerProtectionFee),
    buyerProtectionFeePaidBy: sale.buyerProtectionFeePaidBy ?? 'seller',
    deliveryCost: str(sale.deliveryCost),
    deliveryPaidBy: sale.deliveryPaidBy ?? 'seller',
    vat: str(sale.vat),
    advertisingCost: str(sale.advertisingCost),
    orderTotal: sale.orderTotal !== null && sale.orderTotal !== undefined ? String(sale.orderTotal) : '',
  }
}

/** How much of a sale's order-level fees actually come out of the seller's
 * own pocket — the buyer protection fee and delivery cost only count here
 * when the seller (not the buyer) paid for them; a buyer-paid fee never
 * touches what the seller keeps. */
export function saleFeeTotal(fees: {
  buyerProtectionFee: number
  buyerProtectionFeePaidBy: PaidBy
  deliveryCost: number
  deliveryPaidBy: PaidBy
  vat: number
  advertisingCost: number
}): number {
  return (
    fees.vat +
    fees.advertisingCost +
    (fees.buyerProtectionFeePaidBy === 'seller' ? fees.buyerProtectionFee : 0) +
    (fees.deliveryPaidBy === 'seller' ? fees.deliveryCost : 0)
  )
}

/**
 * Cross-checks the fees you've entered against the order total copied from
 * the marketplace's own receipt — catching a forgotten or mistyped fee
 * before you complete (or save an edit to) a sale, the same way you'd add up
 * a Vinted/eBay order summary by hand. Only meaningful once an order total
 * has actually been entered, so this returns `null` until then.
 *
 * `advertisingCost` is deliberately excluded from the itemised total: it's a
 * seller-side expense (a boosted-listing/ad fee) that never appears on the
 * buyer's own receipt, confirmed against a real eBay "what your buyer paid"
 * breakdown (subtotal + Buyer Protection fee + postage + VAT = order total,
 * with the ad fee only showing up later, under "what you earned").
 *
 * `deliveryCost` is only folded into the itemised total when the buyer paid
 * it. The buyer protection fee is a marketplace-mandated charge that always
 * lands on the buyer's own order total regardless of who ultimately bears
 * the cost, but delivery cost in this app is the seller's actual shipping
 * expense — when the seller pays it (e.g. a free-postage listing), it never
 * appeared on the buyer's receipt at all, so it has no business being added
 * to a total that's supposed to reconcile against what the buyer paid.
 */
export interface OrderTotalCheck {
  /** subtotal + buyer protection fee + (delivery cost, only if the buyer
   * paid it) + VAT — everything a marketplace's own order summary would
   * show as making up the total. */
  itemised: number
  /** The order total as entered, straight from the resolved fees. */
  entered: number
  /** entered − itemised. Positive means the order total is higher than
   * what's been itemised so far (likely a forgotten or undercounted fee);
   * negative means more has been itemised than the order total accounts for. */
  difference: number
  /** Equal within a penny — allows for rounding, not exact float equality. */
  matches: boolean
}

export function checkOrderTotal(
  subtotal: number,
  fees: { buyerProtectionFee: number; deliveryCost: number; deliveryPaidBy: PaidBy; vat: number; orderTotal: number | null },
): OrderTotalCheck | null {
  if (fees.orderTotal === null) return null
  const deliveryOnBuyerReceipt = fees.deliveryPaidBy === 'buyer' ? fees.deliveryCost : 0
  const itemised = subtotal + fees.buyerProtectionFee + deliveryOnBuyerReceipt + fees.vat
  const entered = fees.orderTotal
  const difference = entered - itemised
  return { itemised, entered, difference, matches: Math.abs(difference) < 0.005 }
}

export function buildSaleInput(
  cart: Cart,
  channel: string,
  paymentMethod: PaymentMethod,
  feesDraft?: SaleFeesDraft,
): SaleInput {
  const base: SaleInput = {
    channel: channel.trim(),
    paymentMethod,
    lines: cart.map((line) => ({
      productId: line.product.id,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
    })),
  }
  if (!feesDraft) return base
  return { ...base, ...resolveSaleFeesDraft(feesDraft) }
}

/** Rebuilds an editable cart from a previously recorded sale, looking up each
 * line's current Product by id so quantity/price edits — or removing a line
 * entirely — work exactly like Checkout. A line whose product has since been
 * deleted is dropped; there's no way to edit a line with nothing left to sell. */
export function buildEditCart(sale: Sale, products: Product[]): Cart {
  const byId = new Map(products.map((p) => [p.id, p]))
  const lines: Cart = []
  for (const line of sale.lines) {
    const product = byId.get(line.productId)
    if (!product) continue
    lines.push({ product, quantity: line.quantity, unitPrice: line.unitPrice })
  }
  return lines
}

/** Stock available for a product while editing this sale, as if the sale's
 * original lines had already been reversed — mirrors the reverse-then-reapply
 * logic the backend applies on save, so the on-screen warning doesn't fire
 * for a line that hasn't actually changed. */
export function editableStock(product: Product, originalSale: Sale): number {
  const original = originalSale.lines
    .filter((line) => line.productId === product.id)
    .reduce((sum, line) => sum + line.quantity, 0)
  return product.quantity + original
}

export function editCartLineIssue(line: CartLine, originalSale: Sale): string | null {
  const available = editableStock(line.product, originalSale)
  if (line.quantity > available) {
    return `Only ${available} in stock.`
  }
  return null
}

export function editCartHasIssues(cart: Cart, originalSale: Sale): boolean {
  return cart.some((line) => editCartLineIssue(line, originalSale) !== null)
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
