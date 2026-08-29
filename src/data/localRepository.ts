import {
  describeProductCreated,
  describeProductRemoved,
  describeProductEdit,
  describeReturnEdit,
  describeSaleEdit,
  returnEntityLabel,
  saleEntityLabel,
} from '../domain/activity'
import { applyMovement } from '../domain/movements'
import { validateDraft, nextSku } from '../domain/products'
import { validateReturnCaseInput } from '../domain/returns'
import { saleFeeTotal } from '../domain/sales'
import type { AppliedMovement } from '../domain/movements'
import type {
  ActivityAction,
  ActivityEntityType,
  ActivityLogEntry,
  MovementInput,
  Product,
  ProductDraft,
  Profile,
  ProfileChangeRequest,
  ProfileDraft,
  ProfileUpdateOutcome,
  ReplacementLine,
  Result,
  ReturnCase,
  ReturnCaseInput,
  ReturnLine,
  Sale,
  SaleInput,
  SaleLine,
  StockMovement,
} from '../domain/types'
import { EMPTY_PROFILE_DRAFT } from '../domain/types'
import {
  type Supplier,
  type SupplierDraft,
  type SupplierProduct,
  type SupplierProductDraft,
  type PurchaseOrder,
  type PurchaseOrderInput,
  type PurchaseOrderLine,
  type PurchaseOrderLineUnboxedItem,
  type UnboxedLineItemInput,
  calculatePOSubtotal,
  calculatePOGrandTotal,
} from '../domain/suppliers'
import { DEMO_PRODUCTS } from './demoSeed'
import {
  DUPLICATE_BARCODE,
  DUPLICATE_SKU,
  EMAIL_CHANGE_NOT_SUPPORTED,
  EMPTY_SALE,
  NOT_FOUND,
  RETURN_NOT_FOUND,
  SALE_NOT_FOUND,
  TEAM_NOT_SUPPORTED,
  type InventoryRepository,
  type TeamMember,
} from './repository'

export const STORAGE_KEY = 'stockflow.v1'

interface Snapshot {
  products: Product[]
  movements: StockMovement[]
  sales: Sale[]
  returns: ReturnCase[]
  profile: Profile
  suppliers: Supplier[]
  supplierProducts: SupplierProduct[]
  purchaseOrders: PurchaseOrder[]
  activity: ActivityLogEntry[]
}

export interface LocalRepositoryOptions {
  /** Populate an empty store with the demo catalogue. Defaults to true. */
  seed?: boolean
  storage?: Storage
}

const emptyProfile = (): Profile => ({ ...EMPTY_PROFILE_DRAFT, updatedAt: new Date().toISOString() })

const empty = (): Snapshot => ({
  products: [],
  movements: [],
  sales: [],
  returns: [],
  profile: emptyProfile(),
  suppliers: [],
  supplierProducts: [],
  purchaseOrders: [],
  activity: [],
})

/** Older snapshots predate the entityType/entityId/entityLabel shape below
 * (the log used to only ever cover products, so entries had `productId`/
 * `productName` instead) — migrate those in place on read rather than
 * discarding a user's local history. */
function migrateActivityEntry(raw: unknown): ActivityLogEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const entry = raw as Record<string, unknown>
  if (typeof entry.entityType === 'string') return entry as unknown as ActivityLogEntry
  return {
    id: String(entry.id ?? ''),
    actorName: String(entry.actorName ?? ''),
    entityType: 'product',
    action: (entry.action as ActivityAction) ?? 'edited',
    entityId: (entry.productId as string | null) ?? null,
    entityLabel: String(entry.productName ?? ''),
    detail: String(entry.detail ?? ''),
    createdAt: String(entry.createdAt ?? ''),
  }
}

function read(storage: Storage): Snapshot | null {
  const raw = storage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<Snapshot>
    if (!Array.isArray(parsed.products) || !Array.isArray(parsed.movements)) return empty()
    // Older snapshots predate sales, returns, profile, supplier, and activity-log tracking.
    const sales = Array.isArray(parsed.sales) ? parsed.sales : []
    const returns = Array.isArray(parsed.returns) ? parsed.returns : []
    const profile = parsed.profile && typeof parsed.profile === 'object' ? { ...emptyProfile(), ...parsed.profile } : emptyProfile()
    const suppliers = Array.isArray(parsed.suppliers) ? parsed.suppliers : []
    const supplierProducts = Array.isArray(parsed.supplierProducts) ? parsed.supplierProducts : []
    const purchaseOrders = Array.isArray(parsed.purchaseOrders) ? parsed.purchaseOrders : []
    const activity = Array.isArray(parsed.activity)
      ? parsed.activity.map(migrateActivityEntry).filter((a): a is ActivityLogEntry => a !== null)
      : []
    return { products: parsed.products, movements: parsed.movements, sales, returns, profile, suppliers, supplierProducts, purchaseOrders, activity }
  } catch {
    // Corrupt or hand-edited storage: start clean rather than crash on boot.
    return empty()
  }
}

const newId = (): string =>
  typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `id-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`

/**
 * Offline-first repository backed by localStorage. This is the default backend
 * so the app runs with no credentials at all.
 */
export function createLocalRepository(
  options: LocalRepositoryOptions = {},
): InventoryRepository {
  const storage = options.storage ?? localStorage
  const seed = options.seed ?? true

  let state =
    read(storage) ??
    (seed
      ? {
          products: [...DEMO_PRODUCTS],
          movements: [],
          sales: [],
          returns: [],
          profile: emptyProfile(),
          suppliers: [],
          supplierProducts: [],
          purchaseOrders: [],
          activity: [],
        }
      : empty())

  const persist = () => storage.setItem(STORAGE_KEY, JSON.stringify(state))
  if (!storage.getItem(STORAGE_KEY)) persist()

  // A blank barcode never conflicts — most products won't have one at all.
  const barcodeTaken = (barcode: string, exceptId?: string) =>
    barcode !== '' && state.products.some((p) => p.barcode === barcode && p.id !== exceptId)

  // Mirrors the `products_user_sku_unique` constraint in the Supabase schema,
  // so a duplicate SKU is rejected the same way on both backends.
  const skuTaken = (sku: string, exceptId?: string) =>
    state.products.some((p) => p.sku === sku && p.id !== exceptId)

  // No second real login exists in offline demo mode (see Role's doc comment
  // in repository.ts), so every activity-log entry here is attributed to
  // this one solo user.
  const LOCAL_ACTOR_NAME = 'You'

  const pushActivity = (
    entityType: ActivityEntityType,
    action: ActivityAction,
    entityId: string | null,
    entityLabel: string,
    detail: string,
  ): ActivityLogEntry => {
    const entry: ActivityLogEntry = {
      id: newId(),
      actorName: LOCAL_ACTOR_NAME,
      entityType,
      action,
      entityId,
      entityLabel,
      detail,
      createdAt: new Date().toISOString(),
    }
    // Newest first, matching how movements/sales/returns are already ordered.
    state = { ...state, activity: [entry, ...state.activity] }
    return entry
  }

  return {
    kind: 'local',
    // No second real login exists in offline demo mode — see Role's doc
    // comment in repository.ts for why this is always 'manager' here.
    role: 'manager',

    async listProducts() {
      return state.products.map((p) => ({ ...p }))
    },

    async listMovements() {
      return state.movements.map((m) => ({ ...m }))
    },

    async createProduct(draft: ProductDraft): Promise<Result<Product>> {
      const validated = validateDraft(draft)
      if (!validated.ok) return validated
      if (barcodeTaken(validated.value.barcode)) {
        return { ok: false, error: DUPLICATE_BARCODE }
      }
      if (skuTaken(validated.value.sku)) {
        return { ok: false, error: DUPLICATE_SKU }
      }

      const at = new Date().toISOString()
      const product: Product = { ...validated.value, id: newId(), createdAt: at, updatedAt: at }
      state = { ...state, products: [...state.products, product] }
      pushActivity('product', 'added', product.id, product.name, describeProductCreated(product))
      persist()
      return { ok: true, value: { ...product } }
    },

    async updateProduct(id: string, draft: ProductDraft): Promise<Result<Product>> {
      const existing = state.products.find((p) => p.id === id)
      if (!existing) return { ok: false, error: NOT_FOUND }

      const validated = validateDraft(draft)
      if (!validated.ok) return validated
      if (barcodeTaken(validated.value.barcode, id)) {
        return { ok: false, error: DUPLICATE_BARCODE }
      }
      if (skuTaken(validated.value.sku, id)) {
        return { ok: false, error: DUPLICATE_SKU }
      }

      const updated: Product = {
        ...existing,
        ...validated.value,
        updatedAt: new Date().toISOString(),
      }
      state = {
        ...state,
        products: state.products.map((p) => (p.id === id ? updated : p)),
      }
      // Skip logging a save that changed nothing tracked (e.g. reopening the
      // dialog and hitting Save without editing anything) — see
      // describeProductEdit's own doc comment.
      const detail = describeProductEdit(existing, updated)
      if (detail) pushActivity('product', 'edited', updated.id, updated.name, detail)
      persist()
      return { ok: true, value: { ...updated } }
    },

    async deleteProduct(id: string): Promise<Result<true>> {
      // Movements are kept: the audit trail outlives the catalogue entry.
      const existing = state.products.find((p) => p.id === id)
      state = { ...state, products: state.products.filter((p) => p.id !== id) }
      if (existing) pushActivity('product', 'removed', existing.id, existing.name, describeProductRemoved(existing))
      persist()
      return { ok: true, value: true }
    },

    async recordMovement(
      productId: string,
      input: MovementInput,
    ): Promise<Result<AppliedMovement>> {
      const existing = state.products.find((p) => p.id === productId)
      if (!existing) return { ok: false, error: NOT_FOUND }

      const applied = applyMovement(existing, input, {
        id: newId(),
        at: new Date().toISOString(),
      })
      if (!applied.ok) return applied

      state = {
        ...state,
        products: state.products.map((p) => (p.id === productId ? applied.value.product : p)),
        // Newest first: the history view and CSV export read in this order.
        movements: [applied.value.movement, ...state.movements],
      }
      persist()
      return applied
    },

    async listSales() {
      return state.sales.map((s) => ({ ...s, lines: s.lines.map((l) => ({ ...l })) }))
    },

    async recordSale(input: SaleInput): Promise<Result<Sale>> {
      if (input.lines.length === 0) return { ok: false, error: EMPTY_SALE }

      // Every marketplace fee is optional on the input — most sales (cash,
      // walk-in) have none — so every amount defaults to 0 and delivery
      // defaults to seller-paid, exactly like the Supabase-backed
      // checkout_sale() function does for the cloud repository.
      const buyerProtectionFee = input.buyerProtectionFee ?? 0
      const buyerProtectionFeePaidBy = input.buyerProtectionFeePaidBy ?? 'seller'
      const deliveryCost = input.deliveryCost ?? 0
      const deliveryPaidBy = input.deliveryPaidBy ?? 'seller'
      const vat = input.vat ?? 0
      const advertisingCost = input.advertisingCost ?? 0
      const orderTotal = input.orderTotal ?? null
      const feeTotal = saleFeeTotal({
        buyerProtectionFee,
        buyerProtectionFeePaidBy,
        deliveryCost,
        deliveryPaidBy,
        vat,
        advertisingCost,
      })

      const at = new Date().toISOString()
      const saleId = newId()
      const nextProducts = [...state.products]
      const newMovements: StockMovement[] = []
      const saleLines: SaleLine[] = []

      for (const line of input.lines) {
        const idx = nextProducts.findIndex((p) => p.id === line.productId)
        if (idx === -1) return { ok: false, error: NOT_FOUND }
        const product = nextProducts[idx]

        const applied = applyMovement(
          product,
          {
            type: 'out',
            quantity: line.quantity,
            reason: `Sale — ${input.channel || 'Unspecified'}`,
          },
          { id: newId(), at },
        )
        if (!applied.ok) return applied

        nextProducts[idx] = applied.value.product
        newMovements.push(applied.value.movement)

        const lineTotal = line.unitPrice * line.quantity
        const lineCost = product.cost * line.quantity
        saleLines.push({
          id: newId(),
          saleId,
          productId: product.id,
          sku: product.sku,
          name: product.name,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          unitCost: product.cost,
          lineTotal,
          lineProfit: lineTotal - lineCost,
        })
      }

      const sale: Sale = {
        id: saleId,
        channel: input.channel,
        paymentMethod: input.paymentMethod,
        subtotal: saleLines.reduce((sum, l) => sum + l.lineTotal, 0),
        totalCost: saleLines.reduce((sum, l) => sum + l.unitCost * l.quantity, 0),
        buyerProtectionFee,
        buyerProtectionFeePaidBy,
        deliveryCost,
        deliveryPaidBy,
        vat,
        advertisingCost,
        orderTotal,
        // Net of the marketplace fees above, not just item price minus item
        // cost — the whole point of tracking them is that they come out of
        // what you actually keep.
        profit: saleLines.reduce((sum, l) => sum + l.lineProfit, 0) - feeTotal,
        createdAt: at,
        lines: saleLines,
      }

      state = {
        ...state,
        products: nextProducts,
        movements: [...newMovements, ...state.movements],
        sales: [sale, ...state.sales],
      }
      persist()
      return { ok: true, value: sale }
    },

    async updateSale(id: string, input: SaleInput): Promise<Result<Sale>> {
      const existing = state.sales.find((s) => s.id === id)
      if (!existing) return { ok: false, error: SALE_NOT_FOUND }
      if (input.lines.length === 0) return { ok: false, error: EMPTY_SALE }

      const buyerProtectionFee = input.buyerProtectionFee ?? 0
      const buyerProtectionFeePaidBy = input.buyerProtectionFeePaidBy ?? 'seller'
      const deliveryCost = input.deliveryCost ?? 0
      const deliveryPaidBy = input.deliveryPaidBy ?? 'seller'
      const vat = input.vat ?? 0
      const advertisingCost = input.advertisingCost ?? 0
      const orderTotal = input.orderTotal ?? null
      const feeTotal = saleFeeTotal({
        buyerProtectionFee,
        buyerProtectionFeePaidBy,
        deliveryCost,
        deliveryPaidBy,
        vat,
        advertisingCost,
      })

      const at = new Date().toISOString()
      const nextProducts = [...state.products]
      const newMovements: StockMovement[] = []

      // Reverse the stock effect of every existing line first, so the
      // reapply step below always has an accurate picture of what's on
      // hand — mirrors edit_sale() in supabase/schema.sql exactly. A
      // product that's since been deleted just has its old line dropped.
      for (const line of existing.lines) {
        const idx = nextProducts.findIndex((p) => p.id === line.productId)
        if (idx === -1) continue
        const applied = applyMovement(
          nextProducts[idx],
          { type: 'in', quantity: line.quantity, reason: 'Sale edit — reversal' },
          { id: newId(), at },
        )
        if (!applied.ok) return applied
        nextProducts[idx] = applied.value.product
        newMovements.push(applied.value.movement)
      }

      const saleLines: SaleLine[] = []
      for (const line of input.lines) {
        const idx = nextProducts.findIndex((p) => p.id === line.productId)
        if (idx === -1) return { ok: false, error: NOT_FOUND }
        const product = nextProducts[idx]

        const applied = applyMovement(
          product,
          { type: 'out', quantity: line.quantity, reason: `Sale edit — ${input.channel || 'Unspecified'}` },
          { id: newId(), at },
        )
        if (!applied.ok) return applied
        nextProducts[idx] = applied.value.product
        newMovements.push(applied.value.movement)

        const lineTotal = line.unitPrice * line.quantity
        const lineCost = product.cost * line.quantity
        saleLines.push({
          id: newId(),
          saleId: id,
          productId: product.id,
          sku: product.sku,
          name: product.name,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          unitCost: product.cost,
          lineTotal,
          lineProfit: lineTotal - lineCost,
        })
      }

      const updated: Sale = {
        ...existing,
        channel: input.channel,
        paymentMethod: input.paymentMethod,
        subtotal: saleLines.reduce((sum, l) => sum + l.lineTotal, 0),
        totalCost: saleLines.reduce((sum, l) => sum + l.unitCost * l.quantity, 0),
        buyerProtectionFee,
        buyerProtectionFeePaidBy,
        deliveryCost,
        deliveryPaidBy,
        vat,
        advertisingCost,
        orderTotal,
        profit: saleLines.reduce((sum, l) => sum + l.lineProfit, 0) - feeTotal,
        updatedAt: at,
        lines: saleLines,
      }

      state = {
        ...state,
        products: nextProducts,
        movements: [...newMovements, ...state.movements],
        sales: state.sales.map((s) => (s.id === id ? updated : s)),
      }
      // Skip logging an edit that changed nothing tracked, same reasoning as
      // updateProduct above.
      const saleDetail = describeSaleEdit(existing, updated)
      if (saleDetail) pushActivity('sale', 'edited', updated.id, saleEntityLabel(updated), saleDetail)
      persist()
      return { ok: true, value: updated }
    },

    async listReturns() {
      return state.returns.map((r) => ({
        ...r,
        actions: [...r.actions],
        returnLines: r.returnLines.map((l) => ({ ...l })),
        replacementLines: r.replacementLines.map((l) => ({ ...l })),
      }))
    },

    async recordReturn(input: ReturnCaseInput): Promise<Result<ReturnCase>> {
      const validated = validateReturnCaseInput(input)
      if (!validated.ok) return validated

      const at = new Date().toISOString()
      const returnId = newId()
      const nextProducts = [...state.products]
      const newMovements: StockMovement[] = []
      const returnLines: ReturnLine[] = []
      const replacementLines: ReplacementLine[] = []
      const noted = input.reason?.trim() ? `: ${input.reason.trim()}` : ''

      for (const line of input.returnLines ?? []) {
        const idx = nextProducts.findIndex((p) => p.id === line.productId)
        if (idx === -1) return { ok: false, error: NOT_FOUND }
        const product = nextProducts[idx]

        // Only a restock changes the quantity on hand — a write-off leaves
        // the item out of sellable stock, so it gets no movement of its own;
        // its cost is captured on the return line instead, for loss reporting.
        if (line.disposition === 'restock') {
          const applied = applyMovement(
            product,
            { type: 'in', quantity: line.quantity, reason: `Return — restock${noted}` },
            { id: newId(), at },
          )
          if (!applied.ok) return applied
          nextProducts[idx] = applied.value.product
          newMovements.push(applied.value.movement)
        }

        returnLines.push({
          id: newId(),
          returnId,
          productId: product.id,
          sku: product.sku,
          name: product.name,
          quantity: line.quantity,
          disposition: line.disposition,
          unitCost: product.cost,
        })
      }

      for (const line of input.replacementLines ?? []) {
        const idx = nextProducts.findIndex((p) => p.id === line.productId)
        if (idx === -1) return { ok: false, error: NOT_FOUND }
        const product = nextProducts[idx]

        const applied = applyMovement(
          product,
          { type: 'out', quantity: line.quantity, reason: `Return — replacement${noted}` },
          { id: newId(), at },
        )
        if (!applied.ok) return applied
        nextProducts[idx] = applied.value.product
        newMovements.push(applied.value.movement)

        replacementLines.push({
          id: newId(),
          returnId,
          productId: product.id,
          sku: product.sku,
          name: product.name,
          quantity: line.quantity,
          unitCost: product.cost,
        })
      }

      const actions = input.actions ?? []
      const returnCase: ReturnCase = {
        id: returnId,
        saleId: input.saleId ?? '',
        channel: input.channel ?? '',
        customerRef: input.customerRef ?? '',
        reason: input.reason ?? '',
        notes: input.notes ?? '',
        actions,
        refundAmount: actions.includes('refund') ? (input.refundAmount ?? 0) : 0,
        refundMethod: actions.includes('refund') ? (input.refundMethod ?? null) : null,
        goodwillType: actions.includes('goodwill') ? (input.goodwillType ?? '') : '',
        goodwillValue: actions.includes('goodwill') ? (input.goodwillValue ?? 0) : 0,
        returnLines,
        replacementLines,
        createdAt: at,
      }

      state = {
        ...state,
        products: nextProducts,
        movements: [...newMovements, ...state.movements],
        returns: [returnCase, ...state.returns],
      }
      persist()
      return { ok: true, value: returnCase }
    },

    async updateReturn(id: string, input: ReturnCaseInput): Promise<Result<ReturnCase>> {
      const existing = state.returns.find((r) => r.id === id)
      if (!existing) return { ok: false, error: RETURN_NOT_FOUND }

      const validated = validateReturnCaseInput(input)
      if (!validated.ok) return validated

      const at = new Date().toISOString()
      const nextProducts = [...state.products]
      const newMovements: StockMovement[] = []
      const noted = input.reason?.trim() ? `: ${input.reason.trim()}` : ''

      // Reverse every existing return line's stock effect first — mirrors
      // edit_return() in supabase/schema.sql. A restocked line put stock
      // back on the shelf, so un-doing it has to take that stock back out;
      // if some of it has since been sold, editing is blocked rather than
      // letting stock go negative.
      for (const line of existing.returnLines) {
        if (line.disposition !== 'restock') continue
        const idx = nextProducts.findIndex((p) => p.id === line.productId)
        if (idx === -1) continue
        const product = nextProducts[idx]
        if (product.quantity < line.quantity) {
          return {
            ok: false,
            error: `Cannot edit — ${line.quantity - product.quantity} of the restocked ${line.name} has already been sold.`,
          }
        }
        const applied = applyMovement(
          product,
          { type: 'out', quantity: line.quantity, reason: 'Return edit — reversal' },
          { id: newId(), at },
        )
        if (!applied.ok) return applied
        nextProducts[idx] = applied.value.product
        newMovements.push(applied.value.movement)
      }

      // Reverse every existing replacement line's stock effect (give back
      // the item that was handed to the customer at no charge).
      for (const line of existing.replacementLines) {
        const idx = nextProducts.findIndex((p) => p.id === line.productId)
        if (idx === -1) continue
        const applied = applyMovement(
          nextProducts[idx],
          { type: 'in', quantity: line.quantity, reason: 'Return edit — reversal' },
          { id: newId(), at },
        )
        if (!applied.ok) return applied
        nextProducts[idx] = applied.value.product
        newMovements.push(applied.value.movement)
      }

      const returnLines: ReturnLine[] = []
      for (const line of input.returnLines ?? []) {
        const idx = nextProducts.findIndex((p) => p.id === line.productId)
        if (idx === -1) return { ok: false, error: NOT_FOUND }
        const product = nextProducts[idx]

        if (line.disposition === 'restock') {
          const applied = applyMovement(
            product,
            { type: 'in', quantity: line.quantity, reason: `Return edit — restock${noted}` },
            { id: newId(), at },
          )
          if (!applied.ok) return applied
          nextProducts[idx] = applied.value.product
          newMovements.push(applied.value.movement)
        }

        returnLines.push({
          id: newId(),
          returnId: id,
          productId: product.id,
          sku: product.sku,
          name: product.name,
          quantity: line.quantity,
          disposition: line.disposition,
          unitCost: product.cost,
        })
      }

      const replacementLines: ReplacementLine[] = []
      for (const line of input.replacementLines ?? []) {
        const idx = nextProducts.findIndex((p) => p.id === line.productId)
        if (idx === -1) return { ok: false, error: NOT_FOUND }
        const product = nextProducts[idx]

        const applied = applyMovement(
          product,
          { type: 'out', quantity: line.quantity, reason: `Return edit — replacement${noted}` },
          { id: newId(), at },
        )
        if (!applied.ok) return applied
        nextProducts[idx] = applied.value.product
        newMovements.push(applied.value.movement)

        replacementLines.push({
          id: newId(),
          returnId: id,
          productId: product.id,
          sku: product.sku,
          name: product.name,
          quantity: line.quantity,
          unitCost: product.cost,
        })
      }

      const actions = input.actions ?? []
      const updated: ReturnCase = {
        ...existing,
        saleId: input.saleId ?? '',
        channel: input.channel ?? '',
        customerRef: input.customerRef ?? '',
        reason: input.reason ?? '',
        notes: input.notes ?? '',
        actions,
        refundAmount: actions.includes('refund') ? (input.refundAmount ?? 0) : 0,
        refundMethod: actions.includes('refund') ? (input.refundMethod ?? null) : null,
        goodwillType: actions.includes('goodwill') ? (input.goodwillType ?? '') : '',
        goodwillValue: actions.includes('goodwill') ? (input.goodwillValue ?? 0) : 0,
        returnLines,
        replacementLines,
        updatedAt: at,
      }

      state = {
        ...state,
        products: nextProducts,
        movements: [...newMovements, ...state.movements],
        returns: state.returns.map((r) => (r.id === id ? updated : r)),
      }
      // Skip logging an edit that changed nothing tracked, same reasoning as
      // updateProduct/updateSale above.
      const returnDetail = describeReturnEdit(existing, updated)
      if (returnDetail) pushActivity('return', 'edited', updated.id, returnEntityLabel(updated), returnDetail)
      persist()
      return { ok: true, value: updated }
    },

    async listTeam(): Promise<TeamMember[]> {
      // One person, one role — nothing to list. See the `role` comment above.
      return [{ id: 'you', email: 'you', role: 'manager', status: 'active', isYou: true }]
    },

    async inviteEmployee(): Promise<Result<TeamMember>> {
      return { ok: false, error: TEAM_NOT_SUPPORTED }
    },

    async removeTeamMember(): Promise<Result<true>> {
      return { ok: false, error: TEAM_NOT_SUPPORTED }
    },

    async getProfile(): Promise<Profile> {
      return { ...state.profile }
    },

    async updateProfile(draft: ProfileDraft): Promise<Result<ProfileUpdateOutcome>> {
      // Solo local mode is always 'manager' — an edit here always applies
      // immediately, there's no one else around to approve it.
      const profile: Profile = { ...draft, updatedAt: new Date().toISOString() }
      state = { ...state, profile }
      persist()
      return { ok: true, value: { status: 'applied', profile } }
    },

    async listPendingProfileChanges(): Promise<ProfileChangeRequest[]> {
      // Nothing is ever held pending locally — see updateProfile above.
      return []
    },

    async approveProfileChange(): Promise<Result<true>> {
      return { ok: false, error: TEAM_NOT_SUPPORTED }
    },

    async rejectProfileChange(): Promise<Result<true>> {
      return { ok: false, error: TEAM_NOT_SUPPORTED }
    },

    async getLoginEmail(): Promise<string> {
      // No real auth locally — there's no login email to report.
      return ''
    },

    async updateLoginEmail(): Promise<Result<true>> {
      return { ok: false, error: EMAIL_CHANGE_NOT_SUPPORTED }
    },

    async listSuppliers(): Promise<Supplier[]> {
      return state.suppliers
    },

    async createSupplier(draft: SupplierDraft): Promise<Result<Supplier>> {
      const supplier: Supplier = {
        id: newId(),
        ...draft,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      state.suppliers.push(supplier)
      persist()
      return { ok: true, value: supplier }
    },

    async updateSupplier(id: string, draft: SupplierDraft): Promise<Result<Supplier>> {
      const idx = state.suppliers.findIndex((s) => s.id === id)
      if (idx === -1) return { ok: false, error: NOT_FOUND }
      const updated: Supplier = {
        ...state.suppliers[idx],
        ...draft,
        updatedAt: new Date().toISOString(),
      }
      state.suppliers[idx] = updated
      persist()
      return { ok: true, value: updated }
    },

    async deleteSupplier(id: string): Promise<Result<true>> {
      const idx = state.suppliers.findIndex((s) => s.id === id)
      if (idx === -1) return { ok: false, error: NOT_FOUND }
      state.suppliers.splice(idx, 1)
      // Remove all supplier-product links for this supplier
      state.supplierProducts = state.supplierProducts.filter((sp) => sp.supplierId !== id)
      // Remove all POs from this supplier
      state.purchaseOrders = state.purchaseOrders.filter((po) => po.supplierId !== id)
      persist()
      return { ok: true, value: true }
    },

    async linkSupplierProduct(draft: SupplierProductDraft): Promise<Result<SupplierProduct>> {
      const sp: SupplierProduct = {
        id: newId(),
        ...draft,
        updatedAt: new Date().toISOString(),
      }
      state.supplierProducts.push(sp)
      persist()
      return { ok: true, value: sp }
    },

    async updateSupplierProduct(id: string, draft: SupplierProductDraft): Promise<Result<SupplierProduct>> {
      const idx = state.supplierProducts.findIndex((sp) => sp.id === id)
      if (idx === -1) return { ok: false, error: NOT_FOUND }
      const updated: SupplierProduct = {
        ...state.supplierProducts[idx],
        ...draft,
        updatedAt: new Date().toISOString(),
      }
      state.supplierProducts[idx] = updated
      persist()
      return { ok: true, value: updated }
    },

    async unlinkSupplierProduct(id: string): Promise<Result<true>> {
      const idx = state.supplierProducts.findIndex((sp) => sp.id === id)
      if (idx === -1) return { ok: false, error: NOT_FOUND }
      state.supplierProducts.splice(idx, 1)
      persist()
      return { ok: true, value: true }
    },

    async listSupplierProducts(): Promise<SupplierProduct[]> {
      return state.supplierProducts
    },

    async listPurchaseOrders(): Promise<PurchaseOrder[]> {
      return state.purchaseOrders
    },

    async createPurchaseOrder(input: PurchaseOrderInput): Promise<Result<PurchaseOrder>> {
      const supplier = state.suppliers.find((s) => s.id === input.supplierId)
      if (!supplier) return { ok: false, error: NOT_FOUND }

      const poId = newId()
      const lines: PurchaseOrderLine[] = []
      for (const line of input.lines) {
        if (line.productId) {
          const product = state.products.find((p) => p.id === line.productId)
          if (!product) return { ok: false, error: NOT_FOUND }
          lines.push({
            id: newId(),
            poId,
            productId: product.id,
            sku: product.sku,
            name: product.name,
            quantity: line.quantity,
            unitCost: line.unitCost,
            lineTotal: line.quantity * line.unitCost,
            vatAmount: line.vatAmount,
          })
        } else {
          // A custom-named line (a one-off item not yet in the catalogue) or
          // a mixed lot — neither has a real product until it's received
          // (ordinary line) or unboxed (lot line).
          const name = (line.customName ?? '').trim()
          if (!name) return { ok: false, error: 'Each line needs either a product or a name.' }
          lines.push({
            id: newId(),
            poId,
            sku: '',
            name,
            customName: name,
            isLot: line.isLot === true,
            quantity: line.quantity,
            unitCost: line.unitCost,
            lineTotal: line.quantity * line.unitCost,
            vatAmount: line.vatAmount,
          })
        }
      }

      const subtotal = calculatePOSubtotal(lines)
      const deliveryCost = input.deliveryCost || 0
      const buyersPremium = input.buyersPremium || 0
      const vatAmount = input.vatAmount || 0

      const po: PurchaseOrder = {
        id: poId,
        supplierId: input.supplierId,
        supplierName: supplier.name,
        status: 'draft',
        poNumber: input.poNumber,
        orderDate: input.orderDate,
        expectedDeliveryDate: input.expectedDeliveryDate,
        notes: input.notes,
        lines,
        subtotal,
        deliveryCost,
        buyersPremium,
        vatAmount,
        grandTotal:
          input.grandTotal ?? calculatePOGrandTotal({ subtotal, deliveryCost, buyersPremium, vatAmount }),
        createdAt: new Date().toISOString(),
      }
      state.purchaseOrders.push(po)
      persist()
      return { ok: true, value: po }
    },

    async sendPurchaseOrder(id: string): Promise<Result<PurchaseOrder>> {
      const idx = state.purchaseOrders.findIndex((po) => po.id === id)
      if (idx === -1) return { ok: false, error: NOT_FOUND }
      const po = state.purchaseOrders[idx]
      if (po.status !== 'draft') {
        return { ok: false, error: 'Only draft POs can be sent.' }
      }
      const updated: PurchaseOrder = {
        ...po,
        status: 'sent',
        updatedAt: new Date().toISOString(),
      }
      state.purchaseOrders[idx] = updated
      persist()
      return { ok: true, value: updated }
    },

    async confirmPurchaseOrder(id: string): Promise<Result<PurchaseOrder>> {
      const idx = state.purchaseOrders.findIndex((po) => po.id === id)
      if (idx === -1) return { ok: false, error: NOT_FOUND }
      const po = state.purchaseOrders[idx]
      if (po.status !== 'sent') {
        return { ok: false, error: 'Only sent POs can be confirmed.' }
      }
      const updated: PurchaseOrder = {
        ...po,
        status: 'confirmed',
        updatedAt: new Date().toISOString(),
      }
      state.purchaseOrders[idx] = updated
      persist()
      return { ok: true, value: updated }
    },

    async receivePurchaseOrder(
      id: string,
      lineQuantities: Map<string, number>,
    ): Promise<Result<PurchaseOrder>> {
      const poIdx = state.purchaseOrders.findIndex((po) => po.id === id)
      if (poIdx === -1) return { ok: false, error: NOT_FOUND }
      const po = state.purchaseOrders[poIdx]
      if (po.status !== 'confirmed' && po.status !== 'sent') {
        return { ok: false, error: 'Only sent or confirmed POs can be received.' }
      }

      // Add stock for each ordinary (non-lot) line — a lot line's contents
      // aren't known yet, so it's left alone here and only gains stock once
      // unboxPurchaseOrderLine is called for it.
      const movements: StockMovement[] = []
      for (const line of po.lines) {
        if (line.isLot) continue
        const qty = lineQuantities.get(line.id) ?? line.quantity
        if (qty === 0) continue

        const productIdx = state.products.findIndex((p) => p.id === line.productId)
        if (productIdx === -1) continue

        const applied = applyMovement(
          state.products[productIdx],
          { type: 'in', quantity: qty, reason: `PO received from ${po.supplierName}` },
          { id: newId(), at: new Date().toISOString() },
        )
        if (applied.ok) {
          state.products[productIdx] = applied.value.product
          movements.push(applied.value.movement)
        }
      }

      state.movements.push(...movements)

      const updatedLines = po.lines.map((line) =>
        line.isLot
          ? line
          : {
              ...line,
              quantityReceived: lineQuantities.get(line.id) ?? line.quantity,
            },
      )

      const updated: PurchaseOrder = {
        ...po,
        status: 'received',
        receivedDate: new Date().toISOString(),
        lines: updatedLines,
        updatedAt: new Date().toISOString(),
      }
      state.purchaseOrders[poIdx] = updated
      persist()
      return { ok: true, value: updated }
    },

    async cancelPurchaseOrder(id: string): Promise<Result<PurchaseOrder>> {
      const idx = state.purchaseOrders.findIndex((po) => po.id === id)
      if (idx === -1) return { ok: false, error: NOT_FOUND }
      const po = state.purchaseOrders[idx]
      if (po.status === 'received' || po.status === 'cancelled') {
        return { ok: false, error: 'Cannot cancel a received or already-cancelled PO.' }
      }
      const updated: PurchaseOrder = {
        ...po,
        status: 'cancelled',
        updatedAt: new Date().toISOString(),
      }
      state.purchaseOrders[idx] = updated
      persist()
      return { ok: true, value: updated }
    },

    async unboxPurchaseOrderLine(
      poId: string,
      lineId: string,
      items: UnboxedLineItemInput[],
    ): Promise<Result<PurchaseOrder>> {
      const poIdx = state.purchaseOrders.findIndex((p) => p.id === poId)
      if (poIdx === -1) return { ok: false, error: NOT_FOUND }
      const po = state.purchaseOrders[poIdx]
      if (po.status !== 'received') {
        return { ok: false, error: 'Only a received PO can have a lot unboxed.' }
      }
      const lineIdx = po.lines.findIndex((l) => l.id === lineId)
      if (lineIdx === -1) return { ok: false, error: NOT_FOUND }
      const line = po.lines[lineIdx]
      if (!line.isLot) return { ok: false, error: 'Only a lot line can be unboxed.' }
      if (items.length === 0) return { ok: false, error: 'Add at least one item.' }

      const unboxed: PurchaseOrderLineUnboxedItem[] = []
      const movements: StockMovement[] = []

      for (const item of items) {
        if (item.quantity <= 0) return { ok: false, error: 'Quantity must be greater than zero.' }

        let productIdx: number
        if (item.productId) {
          productIdx = state.products.findIndex((p) => p.id === item.productId)
          if (productIdx === -1) return { ok: false, error: NOT_FOUND }
        } else if (item.newProduct) {
          const sku = item.newProduct.sku.trim() || nextSku(state.products)
          if (state.products.some((p) => p.sku === sku)) {
            return { ok: false, error: DUPLICATE_SKU }
          }
          if (item.newProduct.barcode && state.products.some((p) => p.barcode === item.newProduct!.barcode)) {
            return { ok: false, error: DUPLICATE_BARCODE }
          }
          const validated = validateDraft({
            barcode: item.newProduct.barcode,
            sku,
            name: item.newProduct.name,
            category: item.newProduct.category,
            location: item.newProduct.location,
            variation: '',
            quantity: 0,
            reorderLevel: 0,
            cost: item.quantity > 0 ? item.allocatedCost / item.quantity : 0,
            price: 0,
          })
          if (!validated.ok) return validated
          const at = new Date().toISOString()
          const product: Product = { ...validated.value, id: newId(), createdAt: at, updatedAt: at }
          state.products.push(product)
          pushActivity('product', 'added', product.id, product.name, describeProductCreated(product))
          productIdx = state.products.length - 1
        } else {
          return { ok: false, error: 'Each item needs an existing product or new-product details.' }
        }

        const product = state.products[productIdx]
        const applied = applyMovement(
          product,
          {
            type: 'in',
            quantity: item.quantity,
            reason: `Unboxed from lot "${line.name}" (${po.poNumber})`,
          },
          { id: newId(), at: new Date().toISOString() },
        )
        if (!applied.ok) return applied
        state.products[productIdx] = applied.value.product
        movements.push(applied.value.movement)

        unboxed.push({
          productId: product.id,
          sku: product.sku,
          name: product.name,
          quantity: item.quantity,
          allocatedCost: item.allocatedCost,
        })
      }

      state.movements.push(...movements)

      const updatedLine: PurchaseOrderLine = {
        ...line,
        unboxedInto: [...(line.unboxedInto ?? []), ...unboxed],
      }
      const updatedLines = po.lines.map((l, i) => (i === lineIdx ? updatedLine : l))
      const updated: PurchaseOrder = { ...po, lines: updatedLines, updatedAt: new Date().toISOString() }
      state.purchaseOrders[poIdx] = updated
      persist()
      return { ok: true, value: updated }
    },

    async getAccountSettings() {
      // No account to sync to in offline demo mode — settings already live
      // in this browser's own storage, which is the whole of the model here.
      return null
    },

    async setAccountSettings(): Promise<Result<true>> {
      return { ok: false, error: TEAM_NOT_SUPPORTED }
    },

    async listActivity(): Promise<ActivityLogEntry[]> {
      return state.activity.map((a) => ({ ...a }))
    },

    async logActivity(
      entityType: ActivityEntityType,
      action: ActivityAction,
      entityId: string | null,
      entityLabel: string,
      detail: string,
    ): Promise<void> {
      pushActivity(entityType, action, entityId, entityLabel, detail)
      persist()
    },
  }
}
