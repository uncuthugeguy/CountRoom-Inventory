import type { SupabaseClient } from '@supabase/supabase-js'
import { applyMovement } from '../domain/movements'
import { validateDraft } from '../domain/products'
import type { AppliedMovement } from '../domain/movements'
import type {
  MovementInput,
  PaymentMethod,
  Product,
  ProductDraft,
  ReplacementLine,
  Result,
  ReturnAction,
  ReturnCase,
  ReturnCaseInput,
  ReturnLine,
  Sale,
  SaleInput,
  SaleLine,
  StockDisposition,
  StockMovement,
} from '../domain/types'
import { getSupabaseClient } from './supabaseClient'
import {
  DUPLICATE_BARCODE,
  DUPLICATE_SKU,
  EMPTY_SALE,
  NOT_FOUND,
  type InventoryRepository,
} from './repository'

interface ProductRow {
  id: string
  barcode: string | null
  sku: string
  name: string
  category: string | null
  location: string | null
  variation: string | null
  quantity: number
  reorder_level: number
  // double precision, not numeric — Postgres numeric columns come back from
  // supabase-js as strings to preserve precision; double precision comes
  // back as a plain JS number, which is what the arithmetic here wants.
  cost: number
  price: number
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

interface SaleRow {
  id: string
  channel: string
  payment_method: PaymentMethod
  subtotal: number
  total_cost: number
  profit: number
  created_at: string
}

interface SaleItemRow {
  id: string
  sale_id: string
  product_id: string | null
  sku: string
  name: string
  quantity: number
  unit_price: number
  unit_cost: number
  line_total: number
  line_profit: number
}

interface ReturnRow {
  id: string
  sale_id: string | null
  channel: string
  customer_ref: string
  reason: string
  notes: string
  actions: ReturnAction[]
  refund_amount: number
  refund_method: PaymentMethod | null
  goodwill_type: string
  goodwill_value: number
  created_at: string
}

interface ReturnLineRow {
  id: string
  return_id: string
  product_id: string | null
  sku: string
  name: string
  quantity: number
  disposition: StockDisposition
  unit_cost: number
}

interface ReplacementLineRow {
  id: string
  return_id: string
  product_id: string | null
  sku: string
  name: string
  quantity: number
  unit_cost: number
}

const toProduct = (row: ProductRow): Product => ({
  id: row.id,
  barcode: row.barcode ?? '',
  sku: row.sku,
  name: row.name,
  category: row.category ?? '',
  location: row.location ?? '',
  variation: row.variation ?? '',
  quantity: row.quantity,
  reorderLevel: row.reorder_level,
  cost: row.cost,
  price: row.price,
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

const toSaleLine = (row: SaleItemRow): SaleLine => ({
  id: row.id,
  saleId: row.sale_id,
  productId: row.product_id ?? '',
  sku: row.sku,
  name: row.name,
  quantity: row.quantity,
  unitPrice: row.unit_price,
  unitCost: row.unit_cost,
  lineTotal: row.line_total,
  lineProfit: row.line_profit,
})

const toSale = (row: SaleRow, lines: SaleLine[]): Sale => ({
  id: row.id,
  channel: row.channel,
  paymentMethod: row.payment_method,
  subtotal: row.subtotal,
  totalCost: row.total_cost,
  profit: row.profit,
  createdAt: row.created_at,
  lines,
})

const toReturnLine = (row: ReturnLineRow): ReturnLine => ({
  id: row.id,
  returnId: row.return_id,
  productId: row.product_id ?? '',
  sku: row.sku,
  name: row.name,
  quantity: row.quantity,
  disposition: row.disposition,
  unitCost: row.unit_cost,
})

const toReplacementLine = (row: ReplacementLineRow): ReplacementLine => ({
  id: row.id,
  returnId: row.return_id,
  productId: row.product_id ?? '',
  sku: row.sku,
  name: row.name,
  quantity: row.quantity,
  unitCost: row.unit_cost,
})

const toReturnCase = (
  row: ReturnRow,
  returnLines: ReturnLine[],
  replacementLines: ReplacementLine[],
): ReturnCase => ({
  id: row.id,
  saleId: row.sale_id ?? '',
  channel: row.channel,
  customerRef: row.customer_ref,
  reason: row.reason,
  notes: row.notes,
  actions: row.actions ?? [],
  refundAmount: row.refund_amount,
  refundMethod: row.refund_method,
  goodwillType: row.goodwill_type,
  goodwillValue: row.goodwill_value,
  returnLines,
  replacementLines,
  createdAt: row.created_at,
})

const toRow = (draft: ProductDraft) => ({
  // Stored as null rather than '' so the barcode uniqueness constraint
  // never treats two blank-barcode products as a clash (Postgres allows
  // any number of NULLs in a unique column, but not multiple '' values).
  barcode: draft.barcode === '' ? null : draft.barcode,
  sku: draft.sku,
  name: draft.name,
  category: draft.category,
  location: draft.location,
  variation: draft.variation,
  quantity: draft.quantity,
  reorder_level: draft.reorderLevel,
  cost: draft.cost,
  price: draft.price,
})

/**
 * Postgres unique_violation (23505) is raised by two different constraints on
 * this table — `products_user_id_barcode_key` and `products_user_sku_unique`
 * — so the error text has to be inspected to know which one fired. Getting
 * this wrong shows "barcode already used" for what is actually a SKU clash,
 * which is exactly the confusing failure that made auto-generated SKUs look
 * like they weren't being assigned at all.
 */
const uniqueViolationMessage = (error: {
  code?: string
  message?: string
  details?: string
}): string | null => {
  if (error.code !== '23505') return null
  const text = `${error.message ?? ''} ${error.details ?? ''}`.toLowerCase()
  if (text.includes('sku')) return DUPLICATE_SKU
  if (text.includes('barcode')) return DUPLICATE_BARCODE
  // Constraint name wasn't recognised — fall back to Postgres's own message
  // rather than guessing which field caused it.
  return error.message ?? DUPLICATE_BARCODE
}

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
        return { ok: false, error: uniqueViolationMessage(error) ?? error.message }
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
        return { ok: false, error: uniqueViolationMessage(error) ?? error.message }
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

    async listSales() {
      const { data: saleRows, error } = await db
        .from('sales')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)
      if (error) throw new Error(error.message)
      const sales = saleRows as SaleRow[]
      if (sales.length === 0) return []

      const { data: itemRows, error: itemsError } = await db
        .from('sale_items')
        .select('*')
        .in('sale_id', sales.map((s) => s.id))
      if (itemsError) throw new Error(itemsError.message)

      const bySale = new Map<string, SaleLine[]>()
      for (const row of itemRows as SaleItemRow[]) {
        const line = toSaleLine(row)
        const list = bySale.get(line.saleId) ?? []
        list.push(line)
        bySale.set(line.saleId, list)
      }

      return sales.map((row) => toSale(row, bySale.get(row.id) ?? []))
    },

    async recordSale(input: SaleInput): Promise<Result<Sale>> {
      if (input.lines.length === 0) return { ok: false, error: EMPTY_SALE }

      // Runs server-side as one Postgres transaction (see checkout_sale in
      // supabase/schema.sql) so a sale can never half-apply: either every
      // line decrements stock and gets recorded, or none of it does.
      const { data, error } = await db.rpc('checkout_sale', {
        payload: {
          channel: input.channel,
          paymentMethod: input.paymentMethod,
          lines: input.lines,
        },
      })
      if (error) return { ok: false, error: error.message }

      const saleRow = data as SaleRow
      const { data: itemRows, error: itemsError } = await db
        .from('sale_items')
        .select('*')
        .eq('sale_id', saleRow.id)
      if (itemsError) return { ok: false, error: itemsError.message }

      return {
        ok: true,
        value: toSale(saleRow, (itemRows as SaleItemRow[]).map(toSaleLine)),
      }
    },

    async listReturns() {
      const { data: returnRows, error } = await db
        .from('returns')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)
      if (error) throw new Error(error.message)
      const returns = returnRows as ReturnRow[]
      if (returns.length === 0) return []

      const returnIds = returns.map((r) => r.id)
      const [{ data: lineRows, error: linesError }, { data: replacementRows, error: replacementError }] =
        await Promise.all([
          db.from('return_lines').select('*').in('return_id', returnIds),
          db.from('replacement_lines').select('*').in('return_id', returnIds),
        ])
      if (linesError) throw new Error(linesError.message)
      if (replacementError) throw new Error(replacementError.message)

      const linesByReturn = new Map<string, ReturnLine[]>()
      for (const row of lineRows as ReturnLineRow[]) {
        const line = toReturnLine(row)
        const list = linesByReturn.get(line.returnId) ?? []
        list.push(line)
        linesByReturn.set(line.returnId, list)
      }

      const replacementsByReturn = new Map<string, ReplacementLine[]>()
      for (const row of replacementRows as ReplacementLineRow[]) {
        const line = toReplacementLine(row)
        const list = replacementsByReturn.get(line.returnId) ?? []
        list.push(line)
        replacementsByReturn.set(line.returnId, list)
      }

      return returns.map((row) =>
        toReturnCase(row, linesByReturn.get(row.id) ?? [], replacementsByReturn.get(row.id) ?? []),
      )
    },

    async recordReturn(input: ReturnCaseInput): Promise<Result<ReturnCase>> {
      // Runs server-side as one Postgres transaction (see process_return in
      // supabase/schema.sql), the same way checkout_sale keeps a sale atomic.
      const { data, error } = await db.rpc('process_return', {
        payload: {
          saleId: input.saleId ?? '',
          channel: input.channel ?? '',
          customerRef: input.customerRef ?? '',
          reason: input.reason ?? '',
          notes: input.notes ?? '',
          actions: input.actions,
          refundAmount: input.refundAmount,
          refundMethod: input.refundMethod,
          goodwillType: input.goodwillType,
          goodwillValue: input.goodwillValue,
          returnLines: input.returnLines ?? [],
          replacementLines: input.replacementLines ?? [],
        },
      })
      if (error) return { ok: false, error: error.message }

      const returnRow = data as ReturnRow
      const [{ data: lineRows, error: linesError }, { data: replacementRows, error: replacementError }] =
        await Promise.all([
          db.from('return_lines').select('*').eq('return_id', returnRow.id),
          db.from('replacement_lines').select('*').eq('return_id', returnRow.id),
        ])
      if (linesError) return { ok: false, error: linesError.message }
      if (replacementError) return { ok: false, error: replacementError.message }

      return {
        ok: true,
        value: toReturnCase(
          returnRow,
          (lineRows as ReturnLineRow[]).map(toReturnLine),
          (replacementRows as ReplacementLineRow[]).map(toReplacementLine),
        ),
      }
    },
  }
}
