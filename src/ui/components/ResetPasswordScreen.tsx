import { useState, type FormEvent } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface ResetPasswordScreenProps {
  client: SupabaseClient
  /** Called once the new password is saved, so the caller can drop back into the normal session flow. */
  onDone: () => void
}

/**
 * Shown after the user follows a "reset your password" email link. Supabase
 * has already exchanged that link for a temporary session by the time this
 * renders (see the PASSWORD_RECOVERY handling in App.tsx) — this screen just
 * collects the new password and applies it to that session.
 */
export function ResetPasswordScreen({ client, onDone }: ResetPasswordScreenProps) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)

    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }

    setBusy(true)
    const { error } = await client.auth.updateUser({ password })
    setBusy(false)

    if (error) {
      setError(error.message)
      return
    }

    onDone()
  }

  return (
    <div className="boot">
      <h1>StockFlow</h1>
      <div className="panel" style={{ width: 'min(360px, 100%)', textAlign: 'left' }}>
        <h2>Set a new password</h2>
        <p className="muted">You followed a password reset link. Choose a new password to finish signing in.</p>
        <form className="form" onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="reset-password">New password</label>
            <input
              id="reset-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>
          <div className="field">
            <label htmlFor="reset-password-confirm">Confirm password</label>
            <input
              id="reset-password-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={6}
            />
          </div>

          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}

          <div className="dialog-actions">
            <button type="submit" className="button button-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save new password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
