import type { SupabaseClient } from '@supabase/supabase-js'
import {
  describeMemberInvited,
  describeMemberRemoved,
  describeProductCreated,
  describeProductEdit,
  describeProductRemoved,
  describeReturnEdit,
  describeSaleEdit,
  returnEntityLabel,
  saleEntityLabel,
} from '../domain/activity'
import { applyMovement } from '../domain/movements'
import { MANAGER_ONLY, isManager, productEditNeedsManager } from '../domain/permissions'
import { validateDraft } from '../domain/products'
import type { AppliedMovement } from '../domain/movements'
import type {
  ActivityAction,
  ActivityEntityType,
  ActivityLogEntry,
  MovementInput,
  PaidBy,
  PaymentMethod,
  Product,
  ProductDraft,
  Profile,
  ProfileChangeRequest,
  ProfileDraft,
  ProfileUpdateOutcome,
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
import { EMPTY_PROFILE_DRAFT } from '../domain/types'
import type { QuickCode } from '../domain/quickCodes'
import type { LabelPreset, LabelTemplate } from '../printing/labelTemplate'
import type { Supplier, SupplierProduct, PurchaseOrder } from '../domain/suppliers'
import { getSupabaseClient } from './supabaseClient'
import {
  DUPLICATE_BARCODE,
  DUPLICATE_SKU,
  EMPTY_SALE,
  NOT_FOUND,
  type AccountSettingsSync,
  type InventoryRepository,
  type Role,
  type TeamMember,
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
  updated_at?: string | null
  // Masked to null for a non-manager by sales_view, the same way total_cost
  // and profit are — see the view's definition in supabase/schema.sql.
  buyer_protection_fee?: number | null
  buyer_protection_fee_paid_by?: PaidBy | null
  delivery_cost?: number | null
  delivery_paid_by?: PaidBy | null
  vat?: number | null
  advertising_cost?: number | null
  order_total?: number | null
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
  updated_at?: string | null
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

interface ActivityLogRow {
  id: string
  actor_name: string
  entity_type: ActivityEntityType
  action: ActivityAction
  entity_id: string | null
  entity_label: string
  detail: string
  created_at: string
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
  updatedAt: row.updated_at ?? undefined,
  buyerProtectionFee: row.buyer_protection_fee ?? undefined,
  buyerProtectionFeePaidBy: row.buyer_protection_fee_paid_by ?? undefined,
  deliveryCost: row.delivery_cost ?? undefined,
  deliveryPaidBy: row.delivery_paid_by ?? undefined,
  vat: row.vat ?? undefined,
  advertisingCost: row.advertising_cost ?? undefined,
  orderTotal: row.order_total ?? undefined,
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

const toActivityLogEntry = (row: ActivityLogRow): ActivityLogEntry => ({
  id: row.id,
  actorName: row.actor_name,
  entityType: row.entity_type,
  action: row.action,
  entityId: row.entity_id,
  entityLabel: row.entity_label,
  detail: row.detail,
  createdAt: row.created_at,
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
  updatedAt: row.updated_at ?? undefined,
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
 * Supabase-backed repository. Rows are scoped to the signed-in account by
 * RLS (see supabase/schema.sql) rather than a raw user id sent from the
 * client — the account can now have more than one person on it.
 *
 * Reads for products/sales/returns go through *_view relations rather than
 * the base tables: those views return `cost`/`profit`-shaped columns as
 * `null` for anyone who isn't a manager (enforced server-side, so it can't
 * be bypassed by calling the API directly). Every UI component that shows
 * one of those figures must check `role` before rendering it rather than
 * assuming the value's magnitude — a `null` here means "hidden from you",
 * not "zero".
 */
export async function createSupabaseRepository(url: string, anonKey: string): Promise<InventoryRepository> {
  const db: SupabaseClient = getSupabaseClient(url, anonKey)

  const currentUserId = async (): Promise<string | null> => {
    const { data } = await db.auth.getUser()
    return data.user?.id ?? null
  }

  // Read once at startup rather than on every call — a role change (an
  // invite accepted, someone removed) takes effect on next sign-in, the
  // same way a real permission change usually does.
  const { data: roleData } = await db.rpc('current_role')
  const role: Role = roleData === 'manager' ? 'manager' : 'employee'
  // Needed to address the account_settings upsert below — RLS restricts
  // reads/writes to this account already, but an upsert still has to name
  // the row it's writing.
  const { data: accountIdData } = await db.rpc('current_account_id')
  const accountId = (accountIdData as string | null) ?? null

  // Snapshotted at open time, same reasoning as `role` above — the activity
  // log records who did it *at the time*, so a later email/name change (or
  // this person leaving the team) shouldn't rewrite history.
  const { data: userInfo } = await db.auth.getUser()
  const actorName = userInfo.user?.email ?? 'Unknown'

  // Best-effort by design: the write this rides alongside (a product,
  // sale, return or membership change) has already succeeded by the time
  // this is called, so a failure here (a stale session, a transient
  // network blip) is logged to the console and swallowed rather than ever
  // blocking or rolling back that write — same reasoning as the
  // invite-email send in inviteEmployee below. account_id and actor_id are
  // stamped server-side by a trigger (see stamp_activity_log() in
  // supabase/schema.sql), not sent from here.
  const logActivityBestEffort = async (
    entityType: ActivityEntityType,
    action: ActivityAction,
    entityId: string | null,
    entityLabel: string,
    detail: string,
  ): Promise<void> => {
    try {
      const { error } = await db.from('activity_log').insert({
        actor_name: actorName,
        entity_type: entityType,
        action,
        entity_id: entityId,
        entity_label: entityLabel,
        detail,
      })
      if (error) {
        console.error('Failed to record activity log entry:', error.message)
      }
    } catch (cause) {
      console.error('Failed to record activity log entry:', cause)
    }
  }

  return {
    kind: 'supabase',
    role,

    async listProducts() {
      const { data, error } = await db
        .from('products_view')
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
      const product = toProduct(data as ProductRow)
      await logActivityBestEffort('product', 'added', product.id, product.name, describeProductCreated(product))
      return { ok: true, value: product }
    },

    async updateProduct(id, draft): Promise<Result<Product>> {
      const validated = validateDraft(draft)
      if (!validated.ok) return validated

      // Read the real (unmasked) row first — needed to decide whether an
      // employee's edit is actually trying to change cost/price, and to
      // build the activity-log diff below either way.
      const { data: existingRow, error: readError } = await db
        .from('products')
        .select('*')
        .eq('id', id)
        .maybeSingle()
      if (readError) return { ok: false, error: readError.message }
      if (!existingRow) return { ok: false, error: NOT_FOUND }
      const existing = toProduct(existingRow as ProductRow)

      const fullRow = toRow(validated.value)
      let payload: Partial<typeof fullRow> = fullRow

      if (role !== 'manager') {
        if (productEditNeedsManager(validated.value, existing)) {
          return { ok: false, error: MANAGER_ONLY.editCostOrPrice }
        }
        // Leave cost/price out of the update entirely rather than resending
        // a possibly-masked value — the database trigger is the real
        // enforcement; this just keeps an employee's own edit from
        // accidentally overwriting cost/price with whatever their (hidden)
        // local copy happened to hold.
        const { cost: _cost, price: _price, ...rest } = fullRow
        payload = rest
      }

      const { data, error } = await db
        .from('products')
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .maybeSingle()

      if (error) {
        return { ok: false, error: uniqueViolationMessage(error) ?? error.message }
      }
      if (!data) return { ok: false, error: NOT_FOUND }
      const updated = toProduct(data as ProductRow)

      // Skip logging a save that changed nothing tracked (e.g. reopening the
      // dialog and hitting Save without editing anything).
      const detail = describeProductEdit(existing, updated)
      if (detail) await logActivityBestEffort('product', 'edited', updated.id, updated.name, detail)

      return { ok: true, value: updated }
    },

    async deleteProduct(id): Promise<Result<true>> {
      if (role !== 'manager') return { ok: false, error: MANAGER_ONLY.deleteProduct }

      // Read first and log *before* deleting — activity_log no longer has a
      // hard foreign key to products (entity_id can point at a product,
      // sale, return or membership row depending on entity_type), but
      // reading first is still needed to snapshot the product's name/qty
      // before it's gone. Best-effort either way: if the read or the log
      // insert fails, the delete still goes ahead below.
      const { data: existingRow } = await db.from('products').select('*').eq('id', id).maybeSingle()
      if (existingRow) {
        const existing = toProduct(existingRow as ProductRow)
        await logActivityBestEffort('product', 'removed', existing.id, existing.name, describeProductRemoved(existing))
      }

      const { error } = await db.from('products').delete().eq('id', id)
      if (error) return { ok: false, error: error.message }
      return { ok: true, value: true }
    },

    async recordMovement(productId, input: MovementInput): Promise<Result<AppliedMovement>> {
      if (input.type === 'adjust' && role !== 'manager') {
        return { ok: false, error: MANAGER_ONLY.approveStocktake }
      }

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
        .from('sales_view')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)
      if (error) throw new Error(error.message)
      const sales = saleRows as SaleRow[]
      if (sales.length === 0) return []

      const { data: itemRows, error: itemsError } = await db
        .from('sale_items_view')
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
          buyerProtectionFee: input.buyerProtectionFee ?? 0,
          buyerProtectionFeePaidBy: input.buyerProtectionFeePaidBy ?? 'seller',
          deliveryCost: input.deliveryCost ?? 0,
          deliveryPaidBy: input.deliveryPaidBy ?? 'seller',
          vat: input.vat ?? 0,
          advertisingCost: input.advertisingCost ?? 0,
          orderTotal: input.orderTotal ?? null,
        },
      })
      if (error) return { ok: false, error: error.message }

      // checkout_sale() hands back the real, unmasked row (it reads/writes
      // the base table directly) — re-read it through the view so an
      // employee's own just-completed sale is just as cost/profit-hidden as
      // every other sale in their list, rather than a one-time exception.
      const rawSale = data as SaleRow
      const { data: saleViewRow, error: saleViewError } = await db
        .from('sales_view')
        .select('*')
        .eq('id', rawSale.id)
        .single()
      if (saleViewError) return { ok: false, error: saleViewError.message }
      const saleRow = saleViewRow as SaleRow

      const { data: itemRows, error: itemsError } = await db
        .from('sale_items_view')
        .select('*')
        .eq('sale_id', saleRow.id)
      if (itemsError) return { ok: false, error: itemsError.message }

      return {
        ok: true,
        value: toSale(saleRow, (itemRows as SaleItemRow[]).map(toSaleLine)),
      }
    },

    async updateSale(id: string, input: SaleInput): Promise<Result<Sale>> {
      if (!isManager(role)) return { ok: false, error: MANAGER_ONLY.editSale }
      if (input.lines.length === 0) return { ok: false, error: EMPTY_SALE }

      // Read the pre-edit sale for the activity-log diff below — best-effort:
      // if this read fails, the edit still proceeds, just without a logged
      // diff (matching the same tolerance every other activity-log read has).
      let before: Sale | null = null
      {
        const { data: beforeRow } = await db.from('sales_view').select('*').eq('id', id).maybeSingle()
        if (beforeRow) {
          const { data: beforeItemRows } = await db.from('sale_items_view').select('*').eq('sale_id', id)
          before = toSale(beforeRow as SaleRow, ((beforeItemRows ?? []) as SaleItemRow[]).map(toSaleLine))
        }
      }

      // Runs server-side as one Postgres transaction (see edit_sale in
      // supabase/schema.sql) — it reverses the sale's original stock effect
      // and reapplies the edited lines atomically, the same way checkout_sale
      // applies a new sale.
      const { data, error } = await db.rpc('edit_sale', {
        payload: {
          id,
          channel: input.channel,
          paymentMethod: input.paymentMethod,
          lines: input.lines,
          buyerProtectionFee: input.buyerProtectionFee ?? 0,
          buyerProtectionFeePaidBy: input.buyerProtectionFeePaidBy ?? 'seller',
          deliveryCost: input.deliveryCost ?? 0,
          deliveryPaidBy: input.deliveryPaidBy ?? 'seller',
          vat: input.vat ?? 0,
          advertisingCost: input.advertisingCost ?? 0,
          orderTotal: input.orderTotal ?? null,
        },
      })
      if (error) return { ok: false, error: error.message }

      const rawSale = data as SaleRow
      const { data: saleViewRow, error: saleViewError } = await db
        .from('sales_view')
        .select('*')
        .eq('id', rawSale.id)
        .single()
      if (saleViewError) return { ok: false, error: saleViewError.message }
      const saleRow = saleViewRow as SaleRow

      const { data: itemRows, error: itemsError } = await db
        .from('sale_items_view')
        .select('*')
        .eq('sale_id', saleRow.id)
      if (itemsError) return { ok: false, error: itemsError.message }

      const updated = toSale(saleRow, (itemRows as SaleItemRow[]).map(toSaleLine))

      // Skip logging an edit that changed nothing tracked, same reasoning as
      // the product edit above.
      if (before) {
        const saleDetail = describeSaleEdit(before, updated)
        if (saleDetail) await logActivityBestEffort('sale', 'edited', updated.id, saleEntityLabel(updated), saleDetail)
      }

      return { ok: true, value: updated }
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
          db.from('return_lines_view').select('*').in('return_id', returnIds),
          db.from('replacement_lines_view').select('*').in('return_id', returnIds),
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
          db.from('return_lines_view').select('*').eq('return_id', returnRow.id),
          db.from('replacement_lines_view').select('*').eq('return_id', returnRow.id),
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

    async updateReturn(id: string, input: ReturnCaseInput): Promise<Result<ReturnCase>> {
      if (!isManager(role)) return { ok: false, error: MANAGER_ONLY.editReturn }

      // Read the pre-edit case for the activity-log diff below — best-effort,
      // same reasoning as updateSale's own pre-read above.
      let before: ReturnCase | null = null
      {
        const { data: beforeRow } = await db.from('returns').select('*').eq('id', id).maybeSingle()
        if (beforeRow) {
          const [{ data: beforeLineRows }, { data: beforeReplacementRows }] = await Promise.all([
            db.from('return_lines_view').select('*').eq('return_id', id),
            db.from('replacement_lines_view').select('*').eq('return_id', id),
          ])
          before = toReturnCase(
            beforeRow as ReturnRow,
            ((beforeLineRows ?? []) as ReturnLineRow[]).map(toReturnLine),
            ((beforeReplacementRows ?? []) as ReplacementLineRow[]).map(toReplacementLine),
          )
        }
      }

      // Runs server-side as one Postgres transaction (see edit_return in
      // supabase/schema.sql) — it reverses the case's original stock effect
      // and reapplies the edited one atomically, the same way process_return
      // applies a new case.
      const { data, error } = await db.rpc('edit_return', {
        payload: {
          id,
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
          db.from('return_lines_view').select('*').eq('return_id', returnRow.id),
          db.from('replacement_lines_view').select('*').eq('return_id', returnRow.id),
        ])
      if (linesError) return { ok: false, error: linesError.message }
      if (replacementError) return { ok: false, error: replacementError.message }

      const updated = toReturnCase(
        returnRow,
        (lineRows as ReturnLineRow[]).map(toReturnLine),
        (replacementRows as ReplacementLineRow[]).map(toReplacementLine),
      )

      // Skip logging an edit that changed nothing tracked, same reasoning as
      // updateSale/updateProduct above.
      if (before) {
        const returnDetail = describeReturnEdit(before, updated)
        if (returnDetail) {
          await logActivityBestEffort('return', 'edited', updated.id, returnEntityLabel(updated), returnDetail)
        }
      }

      return { ok: true, value: updated }
    },

    async listTeam(): Promise<TeamMember[]> {
      const myId = await currentUserId()
      const { data, error } = await db
        .from('memberships')
        .select('id, member_id, invited_email, role, status')
        .order('created_at', { ascending: true })
      if (error) throw new Error(error.message)

      return (data as { id: string; member_id: string | null; invited_email: string | null; role: Role; status: 'active' | 'pending' | 'removed' }[])
        .filter((row) => row.status !== 'removed')
        .map((row) => ({
          id: row.id,
          email: row.member_id === myId ? 'You' : row.invited_email ?? '(unknown)',
          role: row.role,
          status: row.status as 'active' | 'pending',
          isYou: row.member_id === myId,
        }))
    },

    async inviteEmployee(email: string): Promise<Result<TeamMember>> {
      const { data, error } = await db.rpc('invite_employee', { p_email: email })
      if (error) return { ok: false, error: error.message }
      const row = data as { id: string; invited_email: string | null; role: Role; status: 'active' | 'pending' }
      const invitedEmail = row.invited_email ?? email

      // The membership row above is what actually grants access — the email
      // below is just a courtesy so the new person doesn't have to be told
      // by hand to go sign in. Only send it for a genuinely new invite
      // (status 'pending'); someone who already had a StockFlow login
      // elsewhere (status 'active', linked in immediately) doesn't need one.
      // A failed send never fails the invite itself — the membership already
      // exists either way — it only changes what the caller tells the
      // manager to do next (see `emailSent` on TeamMember).
      let emailSent: boolean | undefined
      if (row.status === 'pending') {
        try {
          const { error: otpError } = await db.auth.signInWithOtp({
            email: invitedEmail,
            options: { emailRedirectTo: window.location.origin },
          })
          emailSent = !otpError
        } catch {
          emailSent = false
        }
      }

      await logActivityBestEffort(
        'member',
        'invited',
        row.id,
        invitedEmail,
        describeMemberInvited(row.role, row.status !== 'pending'),
      )

      return {
        ok: true,
        value: {
          id: row.id,
          email: invitedEmail,
          role: row.role,
          status: row.status,
          isYou: false,
          emailSent,
        },
      }
    },

    async getProfile(): Promise<Profile> {
      const userId = await currentUserId()
      if (!userId) return { ...EMPTY_PROFILE_DRAFT, updatedAt: new Date().toISOString() }

      const { data, error } = await db
        .from('profiles')
        .select('full_name, birthday, address, employee_number, username, updated_at')
        .eq('member_id', userId)
        .maybeSingle()
      if (error) throw new Error(error.message)
      if (!data) return { ...EMPTY_PROFILE_DRAFT, updatedAt: new Date().toISOString() }

      const row = data as {
        full_name: string
        birthday: string | null
        address: string
        employee_number: string
        username: string
        updated_at: string
      }
      return {
        fullName: row.full_name,
        birthday: row.birthday ?? '',
        address: row.address,
        employeeNumber: row.employee_number,
        username: row.username,
        updatedAt: row.updated_at,
      }
    },

    async updateProfile(draft: ProfileDraft): Promise<Result<ProfileUpdateOutcome>> {
      const { data, error } = await db.rpc('request_profile_update', {
        p_full_name: draft.fullName,
        p_birthday: draft.birthday || null,
        p_address: draft.address,
        p_employee_number: draft.employeeNumber,
        p_username: draft.username,
      })
      if (error) return { ok: false, error: error.message }

      const outcome = data as { status: 'applied' | 'pending'; profile?: Record<string, string> }
      if (outcome.status === 'pending') {
        return { ok: true, value: { status: 'pending' } }
      }
      const p = outcome.profile!
      return {
        ok: true,
        value: {
          status: 'applied',
          profile: {
            fullName: p.fullName,
            birthday: p.birthday,
            address: p.address,
            employeeNumber: p.employeeNumber,
            username: p.username,
            updatedAt: p.updatedAt,
          },
        },
      }
    },

    async listPendingProfileChanges(): Promise<ProfileChangeRequest[]> {
      const { data, error } = await db.rpc('list_pending_profile_changes')
      if (error) throw new Error(error.message)
      return (data as { id: string; invited_email: string | null; proposed: ProfileDraft; requested_at: string }[]).map(
        (row) => ({
          id: row.id,
          memberEmail: row.invited_email ?? '(unknown)',
          proposed: row.proposed,
          status: 'pending',
          requestedAt: row.requested_at,
        }),
      )
    },

    async approveProfileChange(requestId: string): Promise<Result<true>> {
      const { error } = await db.rpc('approve_profile_change', { p_request_id: requestId })
      if (error) return { ok: false, error: error.message }
      return { ok: true, value: true }
    },

    async rejectProfileChange(requestId: string): Promise<Result<true>> {
      const { error } = await db.rpc('reject_profile_change', { p_request_id: requestId })
      if (error) return { ok: false, error: error.message }
      return { ok: true, value: true }
    },

    async removeTeamMember(membershipId: string): Promise<Result<true>> {
      // Read first and log *before* removing — best-effort, same reasoning
      // as deleteProduct's own read-before-delete above: once the membership
      // is gone, its email/role can't be looked back up for the log entry.
      const { data: existingRow } = await db
        .from('memberships')
        .select('invited_email, role')
        .eq('id', membershipId)
        .maybeSingle()

      const { error } = await db.rpc('remove_team_member', { p_membership_id: membershipId })
      if (error) return { ok: false, error: error.message }

      if (existingRow) {
        const row = existingRow as { invited_email: string | null; role: Role }
        const label = row.invited_email ?? '(unknown)'
        await logActivityBestEffort('member', 'removed', membershipId, label, describeMemberRemoved(row.role))
      }

      return { ok: true, value: true }
    },

    async getAccountSettings(): Promise<AccountSettingsSync | null> {
      const { data, error } = await db
        .from('account_settings')
        .select('logo_data_url, label_template, sale_channels, label_presets, quick_codes, product_categories')
        .maybeSingle()
      if (error) throw new Error(error.message)
      if (!data) return null

      const row = data as {
        logo_data_url: string | null
        label_template: LabelTemplate | null
        sale_channels: string[] | null
        label_presets: LabelPreset[] | null
        quick_codes: QuickCode[] | null
        product_categories: string[] | null
      }
      return {
        ...(row.logo_data_url ? { logoDataUrl: row.logo_data_url } : {}),
        ...(row.label_template ? { labelTemplate: row.label_template } : {}),
        ...(row.sale_channels ? { saleChannels: row.sale_channels } : {}),
        ...(row.label_presets ? { labelPresets: row.label_presets } : {}),
        ...(row.quick_codes ? { quickCodes: row.quick_codes } : {}),
        ...(row.product_categories ? { productCategories: row.product_categories } : {}),
      }
    },

    async setAccountSettings(patch: AccountSettingsSync): Promise<Result<true>> {
      if (!accountId) return { ok: false, error: 'Sign in to sync settings.' }

      const payload: Record<string, unknown> = { account_id: accountId, updated_at: new Date().toISOString() }
      if (patch.logoDataUrl !== undefined) payload.logo_data_url = patch.logoDataUrl
      if (patch.labelTemplate !== undefined) payload.label_template = patch.labelTemplate
      if (patch.saleChannels !== undefined) payload.sale_channels = patch.saleChannels
      if (patch.labelPresets !== undefined) payload.label_presets = patch.labelPresets
      if (patch.quickCodes !== undefined) payload.quick_codes = patch.quickCodes
      if (patch.productCategories !== undefined) payload.product_categories = patch.productCategories

      const { error } = await db.from('account_settings').upsert(payload, { onConflict: 'account_id' })
      if (error) return { ok: false, error: error.message }
      return { ok: true, value: true }
    },

    // Supplier & PO methods (manager-only, requires schema extension for Supabase)
    async listSuppliers(): Promise<Supplier[]> {
      return []
    },
    async createSupplier(): Promise<Result<Supplier>> {
      return { ok: false, error: 'Supplier management requires Supabase schema extension.' }
    },
    async updateSupplier(): Promise<Result<Supplier>> {
      return { ok: false, error: 'Supplier management requires Supabase schema extension.' }
    },
    async deleteSupplier(): Promise<Result<true>> {
      return { ok: false, error: 'Supplier management requires Supabase schema extension.' }
    },
    async linkSupplierProduct(): Promise<Result<SupplierProduct>> {
      return { ok: false, error: 'Supplier management requires Supabase schema extension.' }
    },
    async updateSupplierProduct(): Promise<Result<SupplierProduct>> {
      return { ok: false, error: 'Supplier management requires Supabase schema extension.' }
    },
    async unlinkSupplierProduct(): Promise<Result<true>> {
      return { ok: false, error: 'Supplier management requires Supabase schema extension.' }
    },
    async listSupplierProducts(): Promise<SupplierProduct[]> {
      return []
    },
    async listPurchaseOrders(): Promise<PurchaseOrder[]> {
      return []
    },
    async createPurchaseOrder(): Promise<Result<PurchaseOrder>> {
      return { ok: false, error: 'Purchase order management requires Supabase schema extension.' }
    },
    async sendPurchaseOrder(): Promise<Result<PurchaseOrder>> {
      return { ok: false, error: 'Purchase order management requires Supabase schema extension.' }
    },
    async confirmPurchaseOrder(): Promise<Result<PurchaseOrder>> {
      return { ok: false, error: 'Purchase order management requires Supabase schema extension.' }
    },
    async receivePurchaseOrder(): Promise<Result<PurchaseOrder>> {
      return { ok: false, error: 'Purchase order management requires Supabase schema extension.' }
    },
    async cancelPurchaseOrder(): Promise<Result<PurchaseOrder>> {
      return { ok: false, error: 'Purchase order management requires Supabase schema extension.' }
    },

    async listActivity(): Promise<ActivityLogEntry[]> {
      const { data, error } = await db
        .from('activity_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)
      if (error) throw new Error(error.message)
      return (data as ActivityLogRow[]).map(toActivityLogEntry)
    },

    async logActivity(
      entityType: ActivityEntityType,
      action: ActivityAction,
      entityId: string | null,
      entityLabel: string,
      detail: string,
    ): Promise<void> {
      await logActivityBestEffort(entityType, action, entityId, entityLabel, detail)
    },
  }
}
