import type { Product } from './types'

// ============================================================================
// PRODUCT FILTER MODEL
// ============================================================================

export interface ProductFilter {
  /** Text search across name, SKU, barcode, category */
  search?: string
  /** Filter by category */
  categories?: string[]
  /** Filter by location */
  locations?: string[]
  /** Stock status filter */
  stockStatus?: 'all' | 'in-stock' | 'low-stock' | 'out-of-stock'
  /** Price range filter */
  priceRange?: { min: number; max: number }
  /** Margin range (profit %) */
  marginRange?: { min: number; max: number }
  /** Only show items with reorder level set */
  monitored?: boolean
  /** Cost-to-price ratio: items with low margin */
  lowMargin?: boolean
  /** Recently modified */
  recentlyUpdated?: boolean
  /** Case-sensitive search */
  caseSensitive?: boolean
}

/**
 * A reusable filter preset that users can save and apply later.
 */
export interface FilterPreset {
  id: string
  name: string
  description?: string
  filter: ProductFilter
  createdAt: string
  updatedAt: string
}

export type FilterPresetDraft = Omit<FilterPreset, 'id' | 'createdAt' | 'updatedAt'>

// ============================================================================
// SEARCH & FILTER IMPLEMENTATION
// ============================================================================

const SEARCH_FIELDS: Array<keyof Product> = ['name', 'sku', 'barcode', 'category', 'location']

/**
 * Advanced product search with multiple filter criteria.
 * Performs case-insensitive substring matching by default.
 */
export function searchAndFilterProducts(
  products: Product[],
  filter: ProductFilter,
): Product[] {
  return products.filter((product) => {
    // Text search
    if (filter.search) {
      const needle = filter.caseSensitive ? filter.search : filter.search.toLowerCase()
      const match = SEARCH_FIELDS.some((field) => {
        const value = String(product[field])
        const haystack = filter.caseSensitive ? value : value.toLowerCase()
        return haystack.includes(needle)
      })
      if (!match) return false
    }

    // Category filter
    if (filter.categories && filter.categories.length > 0) {
      if (!filter.categories.includes(product.category)) return false
    }

    // Location filter
    if (filter.locations && filter.locations.length > 0) {
      if (!filter.locations.includes(product.location)) return false
    }

    // Stock status filter
    if (filter.stockStatus && filter.stockStatus !== 'all') {
      const isOutOfStock = product.quantity === 0
      const isLowStock = product.reorderLevel > 0 && product.quantity <= product.reorderLevel
      const isInStock = !isOutOfStock && !isLowStock

      if (filter.stockStatus === 'out-of-stock' && !isOutOfStock) return false
      if (filter.stockStatus === 'low-stock' && !isLowStock) return false
      if (filter.stockStatus === 'in-stock' && !isInStock) return false
    }

    // Price range filter
    if (filter.priceRange) {
      if (product.price < filter.priceRange.min || product.price > filter.priceRange.max) {
        return false
      }
    }

    // Margin range filter
    if (filter.marginRange) {
      const margin = product.price > 0 ? ((product.price - product.cost) / product.price) * 100 : 0
      if (margin < filter.marginRange.min || margin > filter.marginRange.max) return false
    }

    // Monitored (has reorder level)
    if (filter.monitored && product.reorderLevel === 0) return false

    // Low margin items
    if (filter.lowMargin) {
      const margin = product.price > 0 ? ((product.price - product.cost) / product.price) * 100 : 0
      if (margin >= 20) return false // Only show if margin < 20%
    }

    // Recently updated (last 7 days)
    if (filter.recentlyUpdated) {
      const weekAgo = new Date()
      weekAgo.setDate(weekAgo.getDate() - 7)
      const updated = new Date(product.updatedAt)
      if (updated < weekAgo) return false
    }

    return true
  })
}

/**
 * Extract all unique values for a field across products.
 * Useful for populating filter dropdowns.
 */
export function getFilterOptions(
  products: Product[],
  field: 'category' | 'location',
): string[] {
  const values = new Set<string>()
  for (const product of products) {
    const value = product[field]
    if (value && value.trim()) {
      values.add(value)
    }
  }
  return Array.from(values).sort()
}

/**
 * Calculate statistics about filtered results.
 */
export interface FilterStats {
  totalCount: number
  outOfStockCount: number
  lowStockCount: number
  totalValue: number // Sum of quantity * price
  totalCost: number // Sum of quantity * cost
  totalProfit: number
  averageMargin: number
}

export function calculateFilterStats(products: Product[]): FilterStats {
  const outOfStockCount = products.filter((p) => p.quantity === 0).length
  const lowStockCount = products.filter(
    (p) => p.reorderLevel > 0 && p.quantity > 0 && p.quantity <= p.reorderLevel,
  ).length

  const totalValue = products.reduce((sum, p) => sum + p.quantity * p.price, 0)
  const totalCost = products.reduce((sum, p) => sum + p.quantity * p.cost, 0)
  const totalProfit = totalValue - totalCost
  const averageMargin = totalValue > 0 ? (totalProfit / totalValue) * 100 : 0

  return {
    totalCount: products.length,
    outOfStockCount,
    lowStockCount,
    totalValue,
    totalCost,
    totalProfit,
    averageMargin,
  }
}

/**
 * Sort products by a specific field.
 */
export type SortField = 'name' | 'sku' | 'quantity' | 'price' | 'cost' | 'margin' | 'created' | 'updated'
export type SortDirection = 'asc' | 'desc'

export function sortProducts(
  products: Product[],
  field: SortField,
  direction: SortDirection = 'asc',
): Product[] {
  const sorted = [...products]

  sorted.sort((a, b) => {
    let aVal: string | number
    let bVal: string | number

    switch (field) {
      case 'name':
      case 'sku':
        aVal = a[field]
        bVal = b[field]
        break
      case 'quantity':
        aVal = a.quantity
        bVal = b.quantity
        break
      case 'price':
        aVal = a.price
        bVal = b.price
        break
      case 'cost':
        aVal = a.cost
        bVal = b.cost
        break
      case 'margin':
        aVal = a.price > 0 ? ((a.price - a.cost) / a.price) * 100 : 0
        bVal = b.price > 0 ? ((b.price - b.cost) / b.price) * 100 : 0
        break
      case 'created':
        aVal = new Date(a.createdAt).getTime()
        bVal = new Date(b.createdAt).getTime()
        break
      case 'updated':
        aVal = new Date(a.updatedAt).getTime()
        bVal = new Date(b.updatedAt).getTime()
        break
    }

    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
    }

    const numA = Number(aVal)
    const numB = Number(bVal)
    return direction === 'asc' ? numA - numB : numB - numA
  })

  return sorted
}

/**
 * Paginate results for large product lists.
 */
export function paginateProducts(
  products: Product[],
  pageNumber: number,
  pageSize: number,
): { results: Product[]; total: number; pages: number; currentPage: number } {
  const total = products.length
  const pages = Math.ceil(total / pageSize)
  const start = (pageNumber - 1) * pageSize
  const end = start + pageSize

  return {
    results: products.slice(start, end),
    total,
    pages,
    currentPage: pageNumber,
  }
}
