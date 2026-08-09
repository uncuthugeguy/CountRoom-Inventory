import { useId, useState, type FormEvent } from 'react'
import type { Role } from '../../data/repository'
import { emptyDraft, knownVariations, nextSku, validateDraft } from '../../domain/products'
import type { Product, ProductDraft, Result } from '../../domain/types'
import { Dialog } from './Dialog'

export interface ProductFormDialogProps {
  /** Set when editing; omitted when creating. */
  product?: Product
  /** Pre-fills the barcode field after a scan of an unknown code. */
  barcode?: string
  /** The full catalogue, used to auto-generate the next SKU and to suggest variations. */
  products: Product[]
  role: Role
  onClose: () => void
  /**
   * `autoSku` tells the caller this SKU was picked automatically rather than
   * typed by hand, so if it turns out to collide with one added elsewhere
   * since this dialog opened, the caller is free to regenerate and retry
   * instead of just surfacing the error.
   */
  onSubmit: (draft: ProductDraft, opts: { autoSku: boolean }) => Promise<Result<Product>>
}

const toDraft = (product: Product): ProductDraft => ({
  barcode: product.barcode,
  sku: product.sku,
  name: product.name,
  category: product.category,
  location: product.location,
  variation: product.variation,
  quantity: product.quantity,
  reorderLevel: product.reorderLevel,
  // An employee's own copy of a product has cost/price hidden by the
  // backend (see supabaseRepository.ts) — coerce that to a safe 0 rather
  // than let a non-finite value fail client-side validation and block an
  // otherwise-unrelated edit. The real value on the server is untouched:
  // the repository excludes cost/price from an employee's update entirely.
  cost: Number.isFinite(product.cost) ? product.cost : 0,
  price: Number.isFinite(product.price) ? product.price : 0,
})

/** Keeps the field empty rather than snapping to 0 while the user retypes. */
const toCount = (value: string): number => (value.trim() === '' ? Number.NaN : Number(value))

export function ProductFormDialog({
  product,
  barcode,
  products,
  role,
  onClose,
  onSubmit,
}: ProductFormDialogProps) {
  const ids = useId()
  const [draft, setDraft] = useState<ProductDraft>(
    product ? toDraft(product) : emptyDraft(barcode ?? ''),
  )
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const variations = knownVariations(products)

  const set = <K extends keyof ProductDraft>(key: K, value: ProductDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)

    // A blank SKU on a new product picks up the next one in the SKU-NNN
    // sequence rather than forcing the user to type it themselves. This is
    // only a best guess based on the catalogue this dialog opened with — the
    // caller may regenerate it if it turns out to be stale.
    const autoSku = !product && draft.sku.trim() === ''
    const withSku = autoSku ? { ...draft, sku: nextSku(products) } : draft

    const validated = validateDraft(withSku)
    if (!validated.ok) {
      setError(validated.error)
      return
    }

    setSaving(true)
    const result = await onSubmit(validated.value, { autoSku })
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onClose()
  }

  const field = (name: string) => `${ids}-${name}`

  return (
    <Dialog title={product ? `Edit ${product.name}` : 'New product'} onClose={onClose}>
      <form className="form" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor={field('barcode')}>Barcode (optional)</label>
          <input
            id={field('barcode')}
            value={draft.barcode}
            inputMode="numeric"
            autoComplete="off"
            onChange={(e) => set('barcode', e.target.value)}
          />
          <p className="hint">Leave blank if this item has no manufacturer barcode.</p>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor={field('sku')}>SKU</label>
            <input
              id={field('sku')}
              value={draft.sku}
              autoComplete="off"
              placeholder={product ? undefined : 'Auto-generated if left blank'}
              onChange={(e) => set('sku', e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor={field('name')}>Name</label>
            <input
              id={field('name')}
              value={draft.name}
              autoComplete="off"
              onChange={(e) => set('name', e.target.value)}
            />
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor={field('category')}>Category</label>
            <input
              id={field('category')}
              value={draft.category}
              autoComplete="off"
              onChange={(e) => set('category', e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor={field('location')}>Location</label>
            <input
              id={field('location')}
              value={draft.location}
              autoComplete="off"
              onChange={(e) => set('location', e.target.value)}
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor={field('variation')}>Variation (optional)</label>
          <input
            id={field('variation')}
            value={draft.variation}
            list={field('variation-options')}
            autoComplete="off"
            placeholder="Colour, size…"
            onChange={(e) => set('variation', e.target.value)}
          />
          <datalist id={field('variation-options')}>
            {variations.map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor={field('quantity')}>Quantity</label>
            <input
              id={field('quantity')}
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={Number.isNaN(draft.quantity) ? '' : draft.quantity}
              onChange={(e) => set('quantity', toCount(e.target.value))}
            />
          </div>
          <div className="field">
            <label htmlFor={field('reorder')}>Reorder level</label>
            <input
              id={field('reorder')}
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={Number.isNaN(draft.reorderLevel) ? '' : draft.reorderLevel}
              onChange={(e) => set('reorderLevel', toCount(e.target.value))}
            />
            <p className="hint">0 turns low-stock alerts off for this line.</p>
          </div>
        </div>

        {role === 'manager' ? (
          <div className="field-row">
            <div className="field">
              <label htmlFor={field('cost')}>Cost</label>
              <input
                id={field('cost')}
                type="number"
                min={0}
                step={0.01}
                inputMode="decimal"
                value={Number.isNaN(draft.cost) ? '' : draft.cost}
                onChange={(e) => set('cost', toCount(e.target.value))}
              />
              <p className="hint">What this unit costs you — used to work out profit at checkout.</p>
            </div>
            <div className="field">
              <label htmlFor={field('price')}>Price</label>
              <input
                id={field('price')}
                type="number"
                min={0}
                step={0.01}
                inputMode="decimal"
                value={Number.isNaN(draft.price) ? '' : draft.price}
                onChange={(e) => set('price', toCount(e.target.value))}
              />
              <p className="hint">Default sale price — checkout lets you override it per sale.</p>
            </div>
          </div>
        ) : (
          <div className="field">
            <p className="hint">
              Cost and price are set by a manager — everything else on this form is still yours to
              edit.
            </p>
          </div>
        )}

        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}

        <div className="dialog-actions">
          <button type="button" className="button button-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button button-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save product'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
