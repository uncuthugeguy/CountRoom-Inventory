import { useState, type FormEvent } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface MfaChallengeScreenProps {
  client: SupabaseClient
  /** The signed-in person's already-verified TOTP factor id. */
  factorId: string
  /** Called once the code is verified and the session has been elevated to AAL2. */
  onVerified: () => void
  onSignOut: () => void
}

/**
 * Shown on every sign-in once a factor is already enrolled: the magic link
 * only gets a session to AAL1, so this collects the authenticator code
 * needed to reach AAL2 before any inventory data is reachable (RLS in
 * schema.sql refuses reads/writes below AAL2 once a verified factor exists).
 */
export function MfaChallengeScreen({ client, factorId, onVerified, onSignOut }: MfaChallengeScreenProps) {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setBusy(true)

    const { data: challenge, error: challengeError } = await client.auth.mfa.challenge({ factorId })
    if (challengeError) {
      setBusy(false)
      setError(challengeError.message)
      return
    }

    const { error: verifyError } = await client.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code: code.trim(),
    })
    setBusy(false)

    if (verifyError) {
      setError(verifyError.message)
      return
    }

    onVerified()
  }

  return (
    <div className="boot">
      <img src="/mark.svg" alt="" className="boot-mark" />
      <h1>Count<span className="brand-accent">Room</span></h1>
      <div className="panel" style={{ width: 'min(360px, 100%)', textAlign: 'left' }}>
        <h2>Enter your authenticator code</h2>
        <p className="muted">Open your authenticator app and enter the current 6-digit code.</p>
        <form className="form" onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="mfa-challenge-code">6-digit code</label>
            <input
              id="mfa-challenge-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              autoFocus
            />
          </div>

          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}

          <div className="dialog-actions">
            <button type="button" className="button button-ghost" onClick={onSignOut}>
              Sign out
            </button>
            <button type="submit" className="button button-primary" disabled={busy || code.trim().length === 0}>
              {busy ? 'Verifying…' : 'Verify'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
