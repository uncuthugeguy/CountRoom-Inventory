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
import type {
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseOrderStatus,
  Supplier,
  SupplierDraft,
  SupplierProduct,
  SupplierProductDraft,
} from '../domain/suppliers'
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

interface SupplierRow {
  id: string
  name: string
  email: string
  phone: string
  address: string
  lead_time_days: number
  contact_name: string
  notes: string
  created_at: string
  updated_at: string
}

interface SupplierProductRow {
  id: string
  supplier_id: string
  product_id: string
  unit_cost: number
  minimum_order: number
  notes: string
  updated_at: string
}

interface PurchaseOrderLineRow {
  id: string
  purchase_order_id: string
  product_id: string | null
  sku: string
  name: string
  quantity: number
  unit_cost: number
  line_total: number
  quantity_received: number | null
}

interface PurchaseOrderRow {
  id: string
  supplier_id: string
  supplier_name: string
  status: PurchaseOrderStatus
  expected_delivery_date: string
  received_date: string | null
  notes: string
  subtotal: number
  created_at: string
  updated_at: string | null
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

const toSupplier = (row: SupplierRow): Supplier => ({
  id: row.id,
  name: row.name,
  email: row.email,
  phone: row.phone,
  address: row.address,
  leadTimeDays: row.lead_time_days,
  contactName: row.contact_name,
  notes: row.notes,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const toSupplierRow = (draft: SupplierDraft) => ({
  name: draft.name,
  email: draft.email,
  phone: draft.phone,
  address: draft.address,
  lead_time_days: draft.leadTimeDays,
  contact_name: draft.contactName,
  notes: draft.notes,
})

const toSupplierProduct = (row: SupplierProductRow): SupplierProduct => ({
  id: row.id,
  productId: row.product_id,
  supplierId: row.supplier_id,
  unitCost: row.unit_cost,
  minimumOrder: row.minimum_order,
  notes: row.notes,
  updatedAt: row.updated_at,
})

const toSupplierProductRow = (draft: SupplierProductDraft) => ({
  product_id: draft.productId,
  supplier_id: draft.supplierId,
  unit_cost: draft.unitCost,
  minimum_order: draft.minimumOrder,
  notes: draft.notes,
})

const toPurchaseOrderLine = (row: PurchaseOrderLineRow): PurchaseOrderLine => ({
  id: row.id,
  poId: row.purchase_order_id,
  productId: row.product_id ?? '',
  sku: row.sku,
  name: row.name,
  quantity: row.quantity,
  unitCost: row.unit_cost,
  lineTotal: row.line_total,
  quantityReceived: row.quantity_received ?? undefined,
})

const toPurchaseOrder = (row: PurchaseOrderRow, lines: PurchaseOrderLine[]): PurchaseOrder => ({
  id: row.id,
  supplierId: row.supplier_id,
  supplierName: row.supplier_name,
  status: row.status,
  expectedDeliveryDate: row.expected_delivery_date,
  receivedDate: row.received_date ?? undefined,
  notes: row.notes,
  lines,
  subtotal: row.subtotal,
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

  const fetchPurchaseOrderLines = async (poId: string): Promise<PurchaseOrderLine[]> => {
    const { data, error } = await db.from('purchase_order_lines').select('*').eq('purchase_order_id', poId)
    if (error) throw new Error(error.message)
    return (data as PurchaseOrderLineRow[]).map(toPurchaseOrderLine)
  }

  const fetchPurchaseOrder = async (id: string): Promise<PurchaseOrder | null> => {
    const { data, error } = await db.from('purchase_orders').select('*').eq('id', id).maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return null
    return toPurchaseOrder(data as PurchaseOrderRow, await fetchPurchaseOrderLines(id))
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
      // (status 'pending'); someone who already had a CountRoom login
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

    // Supplier & PO methods (manager-only end to end — enforced here for a
    // clear inline error, and again by RLS at the database layer as the
    // real backstop; see supplier_po_migration.sql / the block appended to
    // schema.sql).
    async listSuppliers(): Promise<Supplier[]> {
      const { data, error } = await db.from('suppliers').select('*').order('name', { ascending: true })
      if (error) throw new Error(error.message)
      return (data as SupplierRow[]).map(toSupplier)
    },

    async createSupplier(draft): Promise<Result<Supplier>> {
      if (role !== 'manager') return { ok: false, error: MANAGER_ONLY.manageSuppliers }
      // suppliers.user_id has no server-side stamp trigger (unlike
      // products/sales) — it must be set here. RLS still rejects any attempt
      // to write a different account's id, so this can't be spoofed.
      if (!accountId) return { ok: false, error: 'Sign in to add suppliers.' }
      const { data, error } = await db
        .from('suppliers')
        .insert({ ...toSupplierRow(draft), user_id: accountId })
        .select()
        .single()
      if (error) return { ok: false, error: error.message }
      return { ok: true, value: toSupplier(data as SupplierRow) }
    },

    async updateSupplier(id, draft): Promise<Result<Supplier>> {
      if (role !== 'manager') return { ok: false, error: MANAGER_ONLY.manageSuppliers }
      const { data, error } = await db
        .from('suppliers')
        .update(toSupplierRow(draft))
        .eq('id', id)
        .select()
        .maybeSingle()
      if (error) return { ok: false, error: error.message }
      if (!data) return { ok: false, error: NOT_FOUND }
      return { ok: true, value: toSupplier(data as SupplierRow) }
    },

    async deleteSupplier(id): Promise<Result<true>> {
      if (role !== 'manager') return { ok: false, error: MANAGER_ONLY.manageSuppliers }
      // Supplier-product links and this supplier's purchase orders (and
      // their lines) are removed automatically by the foreign keys' `on
      // delete cascade` — matches localRepository's deleteSupplier exactly,
      // which filters both arrays down rather than orphaning them.
      const { error } = await db.from('suppliers').delete().eq('id', id)
      if (error) return { ok: false, error: error.message }
      return { ok: true, value: true }
    },

    async linkSupplierProduct(draft): Promise<Result<SupplierProduct>> {
      if (role !== 'manager') return { ok: false, error: MANAGER_ONLY.manageSuppliers }
      if (!accountId) return { ok: false, error: 'Sign in to link a supplier product.' }
      const { data, error } = await db
        .from('supplier_products')
        .insert({ ...toSupplierProductRow(draft), user_id: accountId })
        .select()
        .single()
      if (error) return { ok: false, error: error.message }
      return { ok: true, value: toSupplierProduct(data as SupplierProductRow) }
    },

    async updateSupplierProduct(id, draft): Promise<Result<SupplierProduct>> {
      if (role !== 'manager') return { ok: false, error: MANAGER_ONLY.manageSuppliers }
      const { data, error } = await db
        .from('supplier_products')
        .update(toSupplierProductRow(draft))
        .eq('id', id)
        .select()
        .maybeSingle()
      if (error) return { ok: false, error: error.message }
      if (!data) return { ok: false, error: NOT_FOUND }
      return { ok: true, value: toSupplierProduct(data as SupplierProductRow) }
    },

    async unlinkSupplierProduct(id): Promise<Result<true>> {
      if (role !== 'manager') return { ok: false, error: MANAGER_ONLY.manageSuppliers }
      const { error } = await db.from('supplier_products').delete().eq('id', id)
      if (error) return { ok: false, error: error.message }
      return { ok: true, value: true }
    },

    async listSupplierProducts(): Promise<SupplierProduct[]> {
      const { data, error } = await db.from('supplier_products').select('*')
      if (error) throw new Error(error.message)
      return (data as SupplierProductRow[]).map(toSupplierProduct)
    },

    async listPurchaseOrders(): Promise<PurchaseOrder[]> {
      const { data: poRows, error } = await db
        .from('purchase_orders')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw new Error(error.message)

      const { data: lineRows, error: linesError } = await db.from('purchase_order_lines').select('*')
      if (linesError) throw new Error(linesError.message)

      const linesByPo = new Map<string, PurchaseOrderLine[]>()
      for (const row of lineRows as PurchaseOrderLineRow[]) {
        const line = toPurchaseOrderLine(row)
        const existing = linesByPo.get(line.poId)
        if (existing) existing.push(line)
        else linesByPo.set(line.poId, [line])
      }

      return (poRows as PurchaseOrderRow[]).map((row) => toPurchaseOrder(row, linesByPo.get(row.id) ?? []))
    },

    async createPurchaseOrder(input): Promise<Result<PurchaseOrder>> {
      if (role !== 'manager') return { ok: false, error: MANAGER_ONLY.manageSuppliers }
      if (!accountId) return { ok: false, error: 'Sign in to create a purchase order.' }

      const { data: supplierRow, error: supplierError } = await db
        .from('suppliers')
        .select('*')
        .eq('id', input.supplierId)
        .maybeSingle()
      if (supplierError) return { ok: false, error: supplierError.message }
      if (!supplierRow) return { ok: false, error: NOT_FOUND }
      const supplier = toSupplier(supplierRow as SupplierRow)

      // Snapshot sku/name from the real product rows for every line — never
      // trust the client's own idea of a product's current sku/name, the
      // same reasoning recordSale builds sale_items from a fresh read.
      const productIds = [...new Set(input.lines.map((line) => line.productId))]
      const { data: productRows, error: productsError } = await db
        .from('products')
        .select('*')
        .in('id', productIds)
      if (productsError) return { ok: false, error: productsError.message }
      const productById = new Map((productRows as ProductRow[]).map((row) => [row.id, toProduct(row)]))

      const linesToInsert: Array<{
        product_id: string
        sku: string
        name: string
        quantity: number
        unit_cost: number
        line_total: number
      }> = []
      for (const line of input.lines) {
        const product = productById.get(line.productId)
        if (!product) return { ok: false, error: NOT_FOUND }
        linesToInsert.push({
          product_id: product.id,
          sku: product.sku,
          name: product.name,
          quantity: line.quantity,
          unit_cost: line.unitCost,
          line_total: line.quantity * line.unitCost,
        })
      }
      const subtotal = linesToInsert.reduce((sum, line) => sum + line.line_total, 0)

      const { data: poRow, error: poError } = await db
        .from('purchase_orders')
        .insert({
          user_id: accountId,
          supplier_id: input.supplierId,
          supplier_name: supplier.name,
          status: 'draft',
          expected_delivery_date: input.expectedDeliveryDate,
          notes: input.notes,
          subtotal,
        })
        .select()
        .single()
      if (poError) return { ok: false, error: poError.message }
      const po = poRow as PurchaseOrderRow

      // No user_id/account_id column on purchase_order_lines — it's scoped
      // by RLS through a join back to purchase_orders.user_id instead (see
      // supabase/schema.sql), so nothing account-related is sent here.
      const { data: lineRows, error: linesError } = await db
        .from('purchase_order_lines')
        .insert(linesToInsert.map((line) => ({ ...line, purchase_order_id: po.id })))
        .select()
      if (linesError) return { ok: false, error: linesError.message }

      return { ok: true, value: toPurchaseOrder(po, (lineRows as PurchaseOrderLineRow[]).map(toPurchaseOrderLine)) }
    },

    async sendPurchaseOrder(id): Promise<Result<PurchaseOrder>> {
      if (role !== 'manager') return { ok: false, error: MANAGER_ONLY.manageSuppliers }
      const existing = await fetchPurchaseOrder(id)
      if (!existing) return { ok: false, error: NOT_FOUND }
      if (existing.status !== 'draft') return { ok: false, error: 'Only draft POs can be sent.' }

      const { data, error } = await db.from('purchase_orders').update({ status: 'sent' }).eq('id', id).select().maybeSingle()
      if (error) return { ok: false, error: error.message }
      if (!data) return { ok: false, error: NOT_FOUND }
      return { ok: true, value: toPurchaseOrder(data as PurchaseOrderRow, existing.lines) }
    },

    async confirmPurchaseOrder(id): Promise<Result<PurchaseOrder>> {
      if (role !== 'manager') return { ok: false, error: MANAGER_ONLY.manageSuppliers }
      const existing = await fetchPurchaseOrder(id)
      if (!existing) return { ok: false, error: NOT_FOUND }
      if (existing.status !== 'sent') return { ok: false, error: 'Only sent POs can be confirmed.' }

      const { data, error } = await db
        .from('purchase_orders')
        .update({ status: 'confirmed' })
        .eq('id', id)
        .select()
        .maybeSingle()
      if (error) return { ok: false, error: error.message }
      if (!data) return { ok: false, error: NOT_FOUND }
      return { ok: true, value: toPurchaseOrder(data as PurchaseOrderRow, existing.lines) }
    },

    async receivePurchaseOrder(id, lineQuantities): Promise<Result<PurchaseOrder>> {
      if (role !== 'manager') return { ok: false, error: MANAGER_ONLY.manageSuppliers }
      const existing = await fetchPurchaseOrder(id)
      if (!existing) return { ok: false, error: NOT_FOUND }
      if (existing.status !== 'confirmed' && existing.status !== 'sent') {
        return { ok: false, error: 'Only sent or confirmed POs can be received.' }
      }

      const userId = await currentUserId()
      if (!userId) return { ok: false, error: 'Sign in to receive a purchase order.' }

      // Add stock for each line — same optimistic-concurrency pattern as
      // recordMovement above (read, apply, write back only if unchanged), so
      // two people receiving stock at once can't step on each other's
      // product row. A line whose product has since been deleted, that
      // receives 0 units, or whose product changed under us mid-receive is
      // skipped rather than failing the whole PO — matches
      // localRepository's receivePurchaseOrder, which is also best-effort
      // per line rather than all-or-nothing.
      for (const line of existing.lines) {
        const qty = lineQuantities.get(line.id) ?? line.quantity
        await db.from('purchase_order_lines').update({ quantity_received: qty }).eq('id', line.id)
        if (qty === 0 || !line.productId) continue

        const { data: productRow } = await db.from('products').select('*').eq('id', line.productId).maybeSingle()
        if (!productRow) continue
        const product = toProduct(productRow as ProductRow)
        const applied = applyMovement(product, {
          type: 'in',
          quantity: qty,
          reason: `PO received from ${existing.supplierName}`,
        })
        if (!applied.ok) continue

        const { data: updatedProduct } = await db
          .from('products')
          .update({ quantity: applied.value.product.quantity, updated_at: applied.value.product.updatedAt })
          .eq('id', line.productId)
          .eq('updated_at', product.updatedAt)
          .select()
          .maybeSingle()
        if (!updatedProduct) continue

        const movement = applied.value.movement
        await db.from('stock_movements').insert({
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
      }

      const { data, error } = await db
        .from('purchase_orders')
        // received_date is a `date` column (see supabase/schema.sql), not
        // timestamptz — send the date part only, same reasoning
        // expected_delivery_date already uses a plain YYYY-MM-DD string.
        .update({ status: 'received', received_date: new Date().toISOString().slice(0, 10) })
        .eq('id', id)
        .select()
        .maybeSingle()
      if (error) return { ok: false, error: error.message }
      if (!data) return { ok: false, error: NOT_FOUND }

      return { ok: true, value: toPurchaseOrder(data as PurchaseOrderRow, await fetchPurchaseOrderLines(id)) }
    },

    async cancelPurchaseOrder(id): Promise<Result<PurchaseOrder>> {
      if (role !== 'manager') return { ok: false, error: MANAGER_ONLY.manageSuppliers }
      const existing = await fetchPurchaseOrder(id)
      if (!existing) return { ok: false, error: NOT_FOUND }
      if (existing.status === 'received' || existing.status === 'cancelled') {
        return { ok: false, error: 'Cannot cancel a received or already-cancelled PO.' }
      }

      const { data, error } = await db
        .from('purchase_orders')
        .update({ status: 'cancelled' })
        .eq('id', id)
        .select()
        .maybeSingle()
      if (error) return { ok: false, error: error.message }
      if (!data) return { ok: false, error: NOT_FOUND }
      return { ok: true, value: toPurchaseOrder(data as PurchaseOrderRow, existing.lines) }
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
