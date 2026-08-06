import type { Product } from './types'

export interface InventorySummary {
  totalProducts: number
  totalUnits: number
  lowStockCount: number
  outOfStockCount: number
}

/**
 * A line is low when it has a reorder level set and has fallen to or below it.
 * A reorder level of zero means "not tracked", so it never reports low.
 */
export function isLowStock(product: Product): boolean {
  return product.reorderLevel > 0 && product.quantity <= product.reorderLevel
}

export function lowStockProducts(products: Product[]): Product[] {
  return products.filter(isLowStock)
}

export function summarise(products: Product[]): InventorySummary {
  return {
    totalProducts: products.length,
    totalUnits: products.reduce((sum, p) => sum + p.quantity, 0),
    lowStockCount: products.filter(isLowStock).length,
    outOfStockCount: products.filter((p) => p.quantity === 0).length,
  }
}

/**
 * Scanner input arrives with trailing Enter/whitespace, so normalise first.
 * Matches on barcode or SKU — not every line has a manufacturer barcode, and
 * a scanned or typed code may be either one.
 */
export function findByScan(products: Product[], code: string): Product | undefined {
  const needle = code.trim()
  if (!needle) return undefined
  const byBarcode = products.find((p) => p.barcode.trim() === needle)
  if (byBarcode) return byBarcode
  const needleLower = needle.toLowerCase()
  return products.find((p) => p.sku.trim().toLowerCase() === needleLower)
}

const SEARCH_FIELDS: Array<keyof Product> = [
  'name',
  'sku',
  'barcode',
  'category',
  'location',
]

export function searchProducts(products: Product[], query: string): Product[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return products
  return products.filter((product) =>
    SEARCH_FIELDS.some((field) => String(product[field]).toLowerCase().includes(needle)),
  )
}
