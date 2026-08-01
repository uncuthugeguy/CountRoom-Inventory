import { useId, useState, type FormEvent } from 'react'
import { validateMovement } from '../../domain/movements'
import type { AppliedMovement } from '../../domain/movements'
import {
  MOVEMENT_LABELS,
  type MovementInput,
  type MovementType,
  type Product,
  type Result,
} from '../../domain/types'
import { Dialog } from './Dialog'

export interface MovementDialogProps {
  product: Product
  type: MovementType
  onClose: () => void
  onSubmit: (input: MovementInput) => Promise<Result<AppliedMovement>>
}

const QUANTITY_LABELS: Record<MovementType, string> = {
  in: 'Quantity received',
  out: 'Quantity removed',
  adjust: 'Counted quantity',
}

const HINTS: Record<MovementType, string> = {
  in: 'Added to the quantity on hand.',
  out: 'Removed from the quantity on hand.',
  adjust: 'Replaces the quantity on hand with the number you counted.',
}

export function MovementDialog({ product, type, onClose, onSubmit }: MovementDialogProps) {
  const ids = useId()
  const [quantity, setQuantity] = useState<string>(type === 'adjust' ? String(product.quantity) : '1')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const parsed = quantity.trim() === '' ? Number.NaN : Number(quantity)
  const preview = validateMovement(product, { type, quantity: parsed })

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)

    if (!preview.ok) {
      setError(preview.error)
      return
    }

    setSaving(true)
    const result = await onSubmit({ type, quantity: parsed, reason })
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onClose()
  }

  return (
    <Dialog title={`${MOVEMENT_LABELS[type]} — ${product.name}`} onClose={onClose}>
      <form className="form" onSubmit={submit} noValidate>
        <p className="dialog-summary">
          <span>{product.sku}</span>
          <span>
            On hand: <strong>{product.quantity}</strong>
          </span>
        </p>

        <div className="field">
          <label htmlFor={`${ids}-quantity`}>{QUANTITY_LABELS[type]}</label>
          <input
            id={`${ids}-quantity`}
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
          <p className="hint">{HINTS[type]}</p>
        </div>

        <div className="field">
          <label htmlFor={`${ids}-reason`}>Reason (optional)</label>
          <input
            id={`${ids}-reason`}
            value={reason}
            autoComplete="off"
            placeholder="Delivery note, job number, stocktake…"
            onChange={(e) => setReason(e.target.value)}
          />
        </div>

        {preview.ok && (
          <p className="preview">
            New quantity on hand: <strong>{product.quantity + preview.value}</strong>
          </p>
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
            {saving ? 'Saving…' : 'Record movement'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
