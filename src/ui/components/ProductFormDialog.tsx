import { useId, useState, type FormEvent } from 'react'
import { emptyDraft, validateDraft } from '../../domain/products'
import type { Product, ProductDraft, Result } from '../../domain/types'
import { Dialog } from './Dialog'

export interface ProductFormDialogProps {
  /** Set when editing; omitted when creating. */
  product?: Product
  /** Pre-fills the barcode field after a scan of an unknown code. */
  barcode?: string
  onClose: () => void
  onSubmit: (draft: ProductDraft) => Promise<Result<Product>>
}

const toDraft = (product: Product): ProductDraft => ({
  barcode: product.barcode,
  sku: product.sku,
  name: product.name,
  category: product.category,
  location: product.location,
  quantity: product.quantity,
  reorderLevel: product.reorderLevel,
})

/** Keeps the field empty rather than snapping to 0 while the user retypes. */
const toCount = (value: string): number => (value.trim() === '' ? Number.NaN : Number(value))

export function ProductFormDialog({
  product,
  barcode,
  onClose,
  onSubmit,
}: ProductFormDialogProps) {
  const ids = useId()
  const [draft, setDraft] = useState<ProductDraft>(
    product ? toDraft(product) : emptyDraft(barcode ?? ''),
  )
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const set = <K extends keyof ProductDraft>(key: K, value: ProductDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)

    const validated = validateDraft(draft)
    if (!validated.ok) {
      setError(validated.error)
      return
    }

    setSaving(true)
    const result = await onSubmit(validated.value)
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
          <label htmlFor={field('barcode')}>Barcode</label>
          <input
            id={field('barcode')}
            value={draft.barcode}
            inputMode="numeric"
            autoComplete="off"
            onChange={(e) => set('barcode', e.target.value)}
          />
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor={field('sku')}>SKU</label>
            <input
              id={field('sku')}
              value={draft.sku}
              autoComplete="off"
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
