import { useState, type FormEvent } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface AuthScreenProps {
  client: SupabaseClient
}

/**
 * Magic-link sign-in — the only sign-in method StockFlow offers. There is no
 * password field anywhere in this flow: `signInWithOtp` creates a brand new
 * account automatically the first time an email is used (Supabase's
 * `shouldCreateUser` defaults to true), so the same form covers sign-up too.
 * Local mode never renders this — it only appears when real Supabase
 * credentials are configured. Once signed in, every user is walked through
 * mandatory TOTP enrollment/verification (see MfaEnrollScreen /
 * MfaChallengeScreen) before reaching the app.
 */
export function AuthScreen({ client }: AuthScreenProps) {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [magicLinkSent, setMagicLinkSent] = useState(false)

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
    setMagicLinkSent(true)
  }

  if (magicLinkSent) {
    return (
      <div className="boot">
        <h1>StockFlow</h1>
        <div className="panel" style={{ width: 'min(360px, 100%)', textAlign: 'left' }}>
          <p className="preview" role="status">
            Check {email} for a sign-in link, then open it on this device.
          </p>
          <div className="dialog-actions">
            <button type="button" className="button button-ghost" onClick={() => setMagicLinkSent(false)}>
              Use a different email
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="boot">
      <h1>StockFlow</h1>
      <div className="panel" style={{ width: 'min(360px, 100%)', textAlign: 'left' }}>
        <h2>Sign in</h2>
        <form className="form" onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="auth-email">Email</label>
            <input
              id="auth-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}

          <div className="dialog-actions">
            <button type="submit" className="button button-primary" disabled={busy}>
              {busy ? 'Please wait…' : 'Send sign-in link'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
