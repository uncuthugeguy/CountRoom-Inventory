import { useState } from 'react'
import { Dialog } from './Dialog'

export interface ConfirmDialogProps {
  title: string
  message: string
  confirmLabel: string
  onCancel: () => void
  onConfirm: () => Promise<void> | void
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false)

  const confirm = async () => {
    setBusy(true)
    await onConfirm()
  }

  return (
    <Dialog title={title} onClose={onCancel}>
      <p className="dialog-message">{message}</p>
      <div className="dialog-actions">
        <button type="button" className="button button-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="button button-danger"
          onClick={confirm}
          disabled={busy}
        >
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  )
}
