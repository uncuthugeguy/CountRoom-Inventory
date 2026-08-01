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
import { DEMO_PRODUCTS } from './demoSeed'
import { DUPLICATE_BARCODE, NOT_FOUND, type InventoryRepository } from './repository'

export const STORAGE_KEY = 'stockflow.v1'

interface Snapshot {
  products: Product[]
  movements: StockMovement[]
}

export interface LocalRepositoryOptions {
  /** Populate an empty store with the demo catalogue. Defaults to true. */
  seed?: boolean
  storage?: Storage
}

const empty = (): Snapshot => ({ products: [], movements: [] })

function read(storage: Storage): Snapshot | null {
  const raw = storage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<Snapshot>
    if (!Array.isArray(parsed.products) || !Array.isArray(parsed.movements)) return empty()
    return { products: parsed.products, movements: parsed.movements }
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

  let state = read(storage) ?? (seed ? { products: [...DEMO_PRODUCTS], movements: [] } : empty())

  const persist = () => storage.setItem(STORAGE_KEY, JSON.stringify(state))
  if (!storage.getItem(STORAGE_KEY)) persist()

  const barcodeTaken = (barcode: string, exceptId?: string) =>
    state.products.some((p) => p.barcode === barcode && p.id !== exceptId)

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
        products: state.products.map((p) => (p.id === productId ? applied.value.product : p)),
        // Newest first: the history view and CSV export read in this order.
        movements: [applied.value.movement, ...state.movements],
      }
      persist()
      return applied
    },
  }
}
