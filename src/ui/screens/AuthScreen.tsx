import { useState, type FormEvent } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'

interface AuthScreenProps {
  client: SupabaseClient
}

/**
 * Passwordless sign-in: StockFlow never handles a password directly. A
 * magic link is emailed to the account already provisioned in Supabase.
 */
export function AuthScreen({ client }: AuthScreenProps) {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setBusy(true)
    const { error } = await client.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    })
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    setSent(true)
  }

  if (sent) {
    return (
      <div className="boot">
        <h1>StockFlow</h1>
        <p className="preview" role="status">
          Check {email} for a sign-in link, then open it on this device.
        </p>
        <button type="button" className="button button-ghost" onClick={() => setSent(false)}>
          Use a different email
        </button>
      </div>
    )
  }

  return (
    <div className="boot">
      <h1>StockFlow</h1>
      <p className="muted">Sign in to sync your inventory across devices.</p>
      <form className="form" style={{ width: 'min(320px, 100%)' }} onSubmit={submit}>
        <div className="field">
          <label htmlFor="auth-email">Email</label>
          <input
            id="auth-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button button-primary" disabled={busy || !email}>
          {busy ? 'Sending…' : 'Send sign-in link'}
        </button>
      </form>
    </div>
  )
}
