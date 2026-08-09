import { useEffect, useState, type FormEvent } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface MfaEnrollScreenProps {
  client: SupabaseClient
  /** Called once a TOTP factor has been enrolled and verified. */
  onEnrolled: () => void
}

/**
 * Mandatory authenticator-app enrollment. Every account must have a verified
 * TOTP factor before it can reach the app — there is no "skip" or "remind me
 * later" here, and the row-level security policies in schema.sql refuse to
 * return any business data for a session that hasn't verified a factor and
 * reached AAL2, so this isn't just a client-side gate.
 */
export function MfaEnrollScreen({ client, onEnrolled }: MfaEnrollScreenProps) {
  const [factorId, setFactorId] = useState<string | null>(null)
  const [qrSvg, setQrSvg] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    void (async () => {
      // A half-finished enrollment from a previous attempt (closed tab,
      // network drop) leaves an "unverified" factor behind — Supabase
      // refuses to enroll a second one under the same friendly name until
      // that's cleared out. `data.totp` only ever contains verified
      // factors, so unverified ones have to be found via `data.all`.
      const { data: existing } = await client.auth.mfa.listFactors()
      const stale = existing?.all?.find((f) => f.factor_type === 'totp' && f.status === 'unverified')
      if (stale) {
        await client.auth.mfa.unenroll({ factorId: stale.id })
      }

      const { data, error } = await client.auth.mfa.enroll({ factorType: 'totp' })
      if (cancelled) return
      setLoading(false)
      if (error) {
        setError(error.message)
        return
      }
      setFactorId(data.id)
      setQrSvg(data.totp.qr_code)
      setSecret(data.totp.secret)
    })()

    return () => {
      cancelled = true
    }
  }, [client])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!factorId) return
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

    onEnrolled()
  }

  return (
    <div className="boot">
      <h1>StockFlow</h1>
      <div className="panel" style={{ width: 'min(400px, 100%)', textAlign: 'left' }}>
        <h2>Set up two-factor authentication</h2>
        <p className="muted">
          StockFlow requires an authenticator app for every account. Scan this code with an app
          like Google Authenticator, 1Password or Authy, then enter the 6-digit code it shows to
          finish setting up.
        </p>

        {loading && (
          <p className="muted" role="status">
            Preparing your authenticator setup…
          </p>
        )}

        {qrSvg && (
          <div
            className="panel"
            style={{ background: '#fff', padding: '.75rem', width: 'fit-content' }}
            // Supabase returns a trusted SVG data URI/markup for the TOTP QR code.
            dangerouslySetInnerHTML={{ __html: qrSvg }}
          />
        )}

        {secret && (
          <p className="muted" style={{ wordBreak: 'break-all' }}>
            Can't scan it? Enter this code manually: <code>{secret}</code>
          </p>
        )}

        {factorId && (
          <form className="form" onSubmit={submit} noValidate>
            <div className="field">
              <label htmlFor="mfa-enroll-code">6-digit code</label>
              <input
                id="mfa-enroll-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
              />
            </div>

            {error && (
              <p className="alert" role="alert">
                {error}
              </p>
            )}

            <div className="dialog-actions">
              <button type="submit" className="button button-primary" disabled={busy || code.trim().length === 0}>
                {busy ? 'Verifying…' : 'Verify and continue'}
              </button>
            </div>
          </form>
        )}

        {!factorId && error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
