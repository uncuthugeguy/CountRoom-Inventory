import type { SupabaseClient } from '@supabase/supabase-js'
import { applyMovement } from '../domain/movements'
import { validateDraft } from '../domain/products'
import type { AppliedMovement } from '../domain/movements'
import type {
  MovementInput,
  Product,
  ProductDraft,
  Result,
  StockMovement,
} from '../domain/types'
import { getSupabaseClient } from './supabaseClient'
import { DUPLICATE_BARCODE, NOT_FOUND, type InventoryRepository } from './repository'

interface ProductRow {
  id: string
  barcode: string
  sku: string
  name: string
  category: string | null
  location: string | null
  quantity: number
  reorder_level: number
  created_at: string
  updated_at: string
}

interface MovementRow {
  id: string
  product_id: string
  type: 'in' | 'out' | 'adjust'
  quantity: number
  delta: number
  previous_quantity: number
  new_quantity: number
  reason: string | null
  created_at: string
}

const toProduct = (row: ProductRow): Product => ({
  id: row.id,
  barcode: row.barcode,
  sku: row.sku,
  name: row.name,
  category: row.category ?? '',
  location: row.location ?? '',
  quantity: row.quantity,
  reorderLevel: row.reorder_level,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const toMovement = (row: MovementRow): StockMovement => ({
  id: row.id,
  productId: row.product_id,
  type: row.type,
  quantity: row.quantity,
  delta: row.delta,
  previousQuantity: row.previous_quantity,
  newQuantity: row.new_quantity,
  reason: row.reason ?? undefined,
  createdAt: row.created_at,
})

const toRow = (draft: ProductDraft) => ({
  barcode: draft.barcode,
  sku: draft.sku,
  name: draft.name,
  category: draft.category,
  location: draft.location,
  quantity: draft.quantity,
  reorder_level: draft.reorderLevel,
})

/** Postgres unique_violation, raised by the barcode uniqueness constraint. */
const isUniqueViolation = (error: { code?: string }) => error.code === '23505'

/**
 * Supabase-backed repository. Rows are scoped to the signed-in user by RLS
 * (see supabase/schema.sql), so no user id is sent from the client.
 */
export function createSupabaseRepository(url: string, anonKey: string): InventoryRepository {
  const db: SupabaseClient = getSupabaseClient(url, anonKey)

  const currentUserId = async (): Promise<string | null> => {
    const { data } = await db.auth.getUser()
    return data.user?.id ?? null
  }

  return {
    kind: 'supabase',

    async listProducts() {
      const { data, error } = await db
        .from('products')
        .select('*')
        .order('name', { ascending: true })
      if (error) throw new Error(error.message)
      return (data as ProductRow[]).map(toProduct)
    },

    async listMovements() {
      const { data, error } = await db
        .from('stock_movements')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)
      if (error) throw new Error(error.message)
      return (data as MovementRow[]).map(toMovement)
    },

    async createProduct(draft): Promise<Result<Product>> {
      const validated = validateDraft(draft)
      if (!validated.ok) return validated

      const userId = await currentUserId()
      if (!userId) return { ok: false, error: 'Sign in to add products.' }

      const { data, error } = await db
        .from('products')
        .insert({ ...toRow(validated.value), user_id: userId })
        .select()
        .single()

      if (error) {
        return { ok: false, error: isUniqueViolation(error) ? DUPLICATE_BARCODE : error.message }
      }
      return { ok: true, value: toProduct(data as ProductRow) }
    },

    async updateProduct(id, draft): Promise<Result<Product>> {
      const validated = validateDraft(draft)
      if (!validated.ok) return validated

      const { data, error } = await db
        .from('products')
        .update({ ...toRow(validated.value), updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .maybeSingle()

      if (error) {
        return { ok: false, error: isUniqueViolation(error) ? DUPLICATE_BARCODE : error.message }
      }
      if (!data) return { ok: false, error: NOT_FOUND }
      return { ok: true, value: toProduct(data as ProductRow) }
    },

    async deleteProduct(id): Promise<Result<true>> {
      const { error } = await db.from('products').delete().eq('id', id)
      if (error) return { ok: false, error: error.message }
      return { ok: true, value: true }
    },

    async recordMovement(productId, input: MovementInput): Promise<Result<AppliedMovement>> {
      const { data: existing, error: readError } = await db
        .from('products')
        .select('*')
        .eq('id', productId)
        .maybeSingle()

      if (readError) return { ok: false, error: readError.message }
      if (!existing) return { ok: false, error: NOT_FOUND }

      const product = toProduct(existing as ProductRow)
      const applied = applyMovement(product, input)
      if (!applied.ok) return applied

      const userId = await currentUserId()
      if (!userId) return { ok: false, error: 'Sign in to record stock movements.' }

      // Optimistic concurrency: the write only lands if nobody else changed the
      // row since we read it, so two devices cannot both spend the same stock.
      const { data: updated, error: writeError } = await db
        .from('products')
        .update({
          quantity: applied.value.product.quantity,
          updated_at: applied.value.product.updatedAt,
        })
        .eq('id', productId)
        .eq('updated_at', product.updatedAt)
        .select()
        .maybeSingle()

      if (writeError) return { ok: false, error: writeError.message }
      if (!updated) {
        return {
          ok: false,
          error: 'This product changed on another device. Reload and try again.',
        }
      }

      const movement = applied.value.movement
      const { data: movementRow, error: auditError } = await db
        .from('stock_movements')
        .insert({
          product_id: movement.productId,
          user_id: userId,
          type: movement.type,
          quantity: movement.quantity,
          delta: movement.delta,
          previous_quantity: movement.previousQuantity,
          new_quantity: movement.newQuantity,
          reason: movement.reason ?? null,
          created_at: movement.createdAt,
        })
        .select()
        .single()

      if (auditError) return { ok: false, error: auditError.message }

      return {
        ok: true,
        value: {
          product: toProduct(updated as ProductRow),
          movement: toMovement(movementRow as MovementRow),
        },
      }
    },
  }
}
