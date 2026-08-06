import { applyMovement } from '../domain/movements'
import { validateDraft } from '../domain/products'
import { validateReturnCaseInput } from '../domain/returns'
import type { AppliedMovement } from '../domain/movements'
import type {
  MovementInput,
  Product,
  ProductDraft,
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
import { DEMO_PRODUCTS } from './demoSeed'
import {
  DUPLICATE_BARCODE,
  DUPLICATE_SKU,
  EMPTY_SALE,
  NOT_FOUND,
  type InventoryRepository,
} from './repository'

export const STORAGE_KEY = 'stockflow.v1'

interface Snapshot {
  products: Product[]
  movements: StockMovement[]
  sales: Sale[]
  returns: ReturnCase[]
}

export interface LocalRepositoryOptions {
  /** Populate an empty store with the demo catalogue. Defaults to true. */
  seed?: boolean
  storage?: Storage
}

const empty = (): Snapshot => ({ products: [], movements: [], sales: [], returns: [] })

function read(storage: Storage): Snapshot | null {
  const raw = storage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<Snapshot>
    if (!Array.isArray(parsed.products) || !Array.isArray(parsed.movements)) return empty()
    // Older snapshots predate sales and returns tracking entirely.
    const sales = Array.isArray(parsed.sales) ? parsed.sales : []
    const returns = Array.isArray(parsed.returns) ? parsed.returns : []
    return { products: parsed.products, movements: parsed.movements, sales, returns }
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
    (seed ? { products: [...DEMO_PRODUCTS], movements: [], sales: [], returns: [] } : empty())

  const persist = () => storage.setItem(STORAGE_KEY, JSON.stringify(state))
  if (!storage.getItem(STORAGE_KEY)) persist()

  // A blank barcode never conflicts — most products won't have one at all.
  const barcodeTaken = (barcode: string, exceptId?: string) =>
    barcode !== '' && state.products.some((p) => p.barcode === barcode && p.id !== exceptId)

  // Mirrors the `products_user_sku_unique` constraint in the Supabase schema,
  // so a duplicate SKU is rejected the same way on both backends.
  const skuTaken = (sku: string, exceptId?: string) =>
    state.products.some((p) => p.sku === sku && p.id !== exceptId)

  return {
    kind: 'local',

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
      persist()
      return { ok: true, value: { ...updated } }
    },

    async deleteProduct(id: string): Promise<Result<true>> {
      // Movements are kept: the audit trail outlives the catalogue entry.
      state = { ...state, products: state.products.filter((p) => p.id !== id) }
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
        profit: saleLines.reduce((sum, l) => sum + l.lineProfit, 0),
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
  }
}
