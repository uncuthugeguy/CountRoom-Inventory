import { useId, useState, type FormEvent, type ReactNode } from 'react'
import type { Result } from '../../domain/types'
import { Dialog } from './Dialog'

export interface PinDialogProps {
  title: string
  message: ReactNode
  confirmLabel: string
  /** Runs the PIN-checked action. The server decides whether the PIN is
   * good enough (a manager's, or any staff member's, per Register's
   * Customize → Permissions → returns setting). */
  onSubmit: (pin: string) => Promise<Result<unknown>>
  onDone: () => void
  onCancel: () => void
  /** Optional extra field, e.g. an inspection note. */
  children?: ReactNode
}

/**
 * Asks for a staff PIN before a return step — the same PINs CountRoom
 * Register uses (set in Register under your staff profile), checked by the
 * same server functions, so a step approved here is recorded exactly as it
 * would be at the till.
 */
export function PinDialog({ title, message, confirmLabel, onSubmit, onDone, onCancel, children }: PinDialogProps) {
  const pinId = useId()
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setChecking(true)
    setError(null)
    const result = await onSubmit(pin)
    setChecking(false)
    if (!result.ok) {
      setError(result.error || 'PIN not recognised or not allowed to approve this.')
      setPin('')
      return
    }
    onDone()
  }

  return (
    <Dialog title={title} onClose={onCancel}>
      <form onSubmit={submit} data-testid="pin-dialog">
        <p className="muted">{message}</p>
        {children}
        <div className="field">
          <label htmlFor={pinId}>PIN</label>
          <input
            id={pinId}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          />
        </div>
        <p className="hint">Use your CountRoom Register PIN.</p>
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="button button-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="button button-primary" disabled={checking || pin.length < 4}>
            {checking ? 'Checking…' : confirmLabel}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
