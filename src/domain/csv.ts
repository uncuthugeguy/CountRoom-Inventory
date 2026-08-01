import { isLowStock } from './inventory'
import type { Product, StockMovement } from './types'

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
  { label: 'Quantity', value: (p) => p.quantity },
  { label: 'Reorder Level', value: (p) => p.reorderLevel },
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
