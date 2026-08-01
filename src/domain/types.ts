export interface Product {
  id: string
  barcode: string
  sku: string
  name: string
  category: string
  location: string
  quantity: number
  reorderLevel: number
  createdAt: string
  updatedAt: string
}

/** Fields a user supplies when creating or editing a product. */
export type ProductDraft = Omit<Product, 'id' | 'createdAt' | 'updatedAt'>

export type MovementType = 'in' | 'out' | 'adjust'

export interface MovementInput {
  type: MovementType
  /**
   * For `in` and `out` this is the magnitude to add or remove.
   * For `adjust` this is the new absolute count on hand (a stocktake).
   */
  quantity: number
  reason?: string
}

export interface StockMovement {
  id: string
  productId: string
  type: MovementType
  /** The quantity as entered by the user (see MovementInput). */
  quantity: number
  /** Signed change applied to the quantity on hand. */
  delta: number
  previousQuantity: number
  newQuantity: number
  reason?: string
  createdAt: string
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  in: 'Stock in',
  out: 'Stock out',
  adjust: 'Adjust',
}
