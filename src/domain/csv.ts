import { isLowStock } from './inventory'
import { returnImpact } from './returns'
import { PAID_BY_LABELS, PAYMENT_METHOD_LABELS, RETURN_ACTION_LABELS } from './types'
import type { Product, ReturnCase, Sale, StockMovement } from './types'

const NEEDS_QUOTING = /[",\r\n]/
const HAS_PADDING = /^\s|\s$/
/** Leading characters that spreadsheets treat as the start of a formula. */
const FORMULA_START = /^[=+\-@\t\r]/

/**
 * Renders a single CSV field per RFC 4180: quote when the value contains a
 * delimiter, quote or line break, and double any embedded quotes. Text that a
 * spreadsheet would evaluate as a formula is prefixed with an apostrophe.
 */
export function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return ''

  let text = String(value)
  const isText = typeof value === 'string'
  const dangerous = isText && FORMULA_START.test(text)
  if (dangerous) text = `'${text}`

  if (dangerous || NEEDS_QUOTING.test(text) || HAS_PADDING.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

export interface CsvColumn<T> {
  label: string
  value: (row: T) => unknown
}

export function toCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const header = columns.map((c) => escapeCsvValue(c.label)).join(',')
  const body = rows.map((row) =>
    columns.map((c) => escapeCsvValue(c.value(row))).join(','),
  )
  return [header, ...body].join('\r\n')
}

const PRODUCT_COLUMNS: CsvColumn<Product>[] = [
  { label: 'Barcode', value: (p) => p.barcode },
  { label: 'SKU', value: (p) => p.sku },
  { label: 'Name', value: (p) => p.name },
  { label: 'Category', value: (p) => p.category },
  { label: 'Location', value: (p) => p.location },
  { label: 'Variation', value: (p) => p.variation },
  { label: 'Quantity', value: (p) => p.quantity },
  { label: 'Reorder Level', value: (p) => p.reorderLevel },
  { label: 'Cost', value: (p) => p.cost },
  { label: 'Price', value: (p) => p.price },
  { label: 'Low Stock', value: (p) => (isLowStock(p) ? 'yes' : 'no') },
  { label: 'Updated', value: (p) => p.updatedAt },
]

export function productsToCsv(products: Product[]): string {
  return toCsv(PRODUCT_COLUMNS, products)
}

export function movementsToCsv(
  movements: StockMovement[],
  productNames: Record<string, string>,
): string {
  const columns: CsvColumn<StockMovement>[] = [
    { label: 'Timestamp', value: (m) => m.createdAt },
    { label: 'Product', value: (m) => productNames[m.productId] ?? '' },
    { label: 'Type', value: (m) => m.type },
    { label: 'Quantity', value: (m) => m.quantity },
    { label: 'Delta', value: (m) => m.delta },
    { label: 'Previous', value: (m) => m.previousQuantity },
    { label: 'New', value: (m) => m.newQuantity },
    { label: 'Reason', value: (m) => m.reason },
  ]
  return toCsv(columns, movements)
}

export function salesToCsv(sales: Sale[]): string {
  const columns: CsvColumn<Sale>[] = [
    { label: 'Timestamp', value: (s) => s.createdAt },
    { label: 'Channel', value: (s) => s.channel },
    { label: 'Payment Method', value: (s) => PAYMENT_METHOD_LABELS[s.paymentMethod] },
    { label: 'Items', value: (s) => s.lines.map((l) => `${l.quantity}x ${l.sku}`).join('; ') },
    { label: 'Subtotal', value: (s) => s.subtotal.toFixed(2) },
    { label: 'Cost', value: (s) => s.totalCost.toFixed(2) },
    { label: 'Buyer Protection Fee', value: (s) => (s.buyerProtectionFee ?? 0).toFixed(2) },
    { label: 'Buyer Protection Fee Paid By', value: (s) => PAID_BY_LABELS[s.buyerProtectionFeePaidBy ?? 'seller'] },
    { label: 'Delivery Cost', value: (s) => (s.deliveryCost ?? 0).toFixed(2) },
    { label: 'Delivery Paid By', value: (s) => PAID_BY_LABELS[s.deliveryPaidBy ?? 'seller'] },
    { label: 'VAT', value: (s) => (s.vat ?? 0).toFixed(2) },
    { label: 'Advertising Cost', value: (s) => (s.advertisingCost ?? 0).toFixed(2) },
    { label: 'Order Total', value: (s) => (s.orderTotal === null || s.orderTotal === undefined ? '' : s.orderTotal.toFixed(2)) },
    { label: 'Profit', value: (s) => s.profit.toFixed(2) },
  ]
  return toCsv(columns, sales)
}

export function returnsToCsv(cases: ReturnCase[]): string {
  const columns: CsvColumn<ReturnCase>[] = [
    { label: 'Timestamp', value: (r) => r.createdAt },
    { label: 'Channel', value: (r) => r.channel },
    { label: 'Customer', value: (r) => r.customerRef },
    { label: 'Actions', value: (r) => r.actions.map((a) => RETURN_ACTION_LABELS[a]).join('; ') },
    {
      label: 'Returned Items',
      value: (r) => r.returnLines.map((l) => `${l.quantity}x ${l.sku} (${l.disposition})`).join('; '),
    },
    {
      label: 'Replacement Items',
      value: (r) => r.replacementLines.map((l) => `${l.quantity}x ${l.sku}`).join('; '),
    },
    { label: 'Refund Amount', value: (r) => r.refundAmount.toFixed(2) },
    { label: 'Refund Method', value: (r) => (r.refundMethod ? PAYMENT_METHOD_LABELS[r.refundMethod] : '') },
    { label: 'Goodwill Type', value: (r) => r.goodwillType },
    { label: 'Goodwill Value', value: (r) => r.goodwillValue.toFixed(2) },
    { label: 'Write-off Loss', value: (r) => returnImpact(r).writeOffLoss.toFixed(2) },
    { label: 'Total Cost', value: (r) => returnImpact(r).totalCost.toFixed(2) },
    { label: 'Reason', value: (r) => r.reason },
    { label: 'Notes', value: (r) => r.notes },
  ]
  return toCsv(columns, cases)
}
