import type { AppliedMovement } from '../domain/movements'
import type { MovementInput, Product, ProductDraft, Result, StockMovement } from '../domain/types'

export interface InventoryRepository {
  /** Shown in the UI so it is obvious which backend is live. */
  readonly kind: 'local' | 'supabase'
  listProducts(): Promise<Product[]>
  listMovements(): Promise<StockMovement[]>
  createProduct(draft: ProductDraft): Promise<Result<Product>>
  updateProduct(id: string, draft: ProductDraft): Promise<Result<Product>>
  deleteProduct(id: string): Promise<Result<true>>
  recordMovement(productId: string, input: MovementInput): Promise<Result<AppliedMovement>>
}

export const NOT_FOUND = 'Product not found.'
export const DUPLICATE_BARCODE = 'That barcode is already used by another product.'
