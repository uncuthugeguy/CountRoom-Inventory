import type { AppliedMovement } from '../domain/movements'
import type {
  MovementInput,
  Product,
  ProductDraft,
  Result,
  ReturnCase,
  ReturnCaseInput,
  Sale,
  SaleInput,
  StockMovement,
} from '../domain/types'

export interface InventoryRepository {
  /** Shown in the UI so it is obvious which backend is live. */
  readonly kind: 'local' | 'supabase'
  listProducts(): Promise<Product[]>
  listMovements(): Promise<StockMovement[]>
  createProduct(draft: ProductDraft): Promise<Result<Product>>
  updateProduct(id: string, draft: ProductDraft): Promise<Result<Product>>
  deleteProduct(id: string): Promise<Result<true>>
  recordMovement(productId: string, input: MovementInput): Promise<Result<AppliedMovement>>
  listSales(): Promise<Sale[]>
  /** Decrements stock for every line and records the sale as one atomic unit. */
  recordSale(input: SaleInput): Promise<Result<Sale>>
  listReturns(): Promise<ReturnCase[]>
  /**
   * Applies the stock effects of a return case (restocking, writing off,
   * handing out a replacement) and records the case as one atomic unit.
   */
  recordReturn(input: ReturnCaseInput): Promise<Result<ReturnCase>>
}

export const NOT_FOUND = 'Product not found.'
export const DUPLICATE_BARCODE = 'That barcode is already used by another product.'
export const DUPLICATE_SKU = 'That SKU is already used by another product.'
export const EMPTY_SALE = 'Add at least one item before checking out.'
export const EMPTY_RETURN = 'Add at least one action, item, refund, or note before saving.'
