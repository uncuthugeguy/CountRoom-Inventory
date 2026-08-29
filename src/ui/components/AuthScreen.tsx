import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { addRecentEmail, loadRecentEmails } from '../../data/recentEmailsStorage'

export interface AuthScreenProps {
  client: SupabaseClient
  /** Overridden in tests so the suite never touches the host's real localStorage. */
  emailStorage?: Storage
}

/**
 * Magic-link sign-in — the only sign-in method CountRoom offers. There is no
 * password field anywhere in this flow: `signInWithOtp` creates a brand new
 * account automatically the first time an email is used (Supabase's
 * `shouldCreateUser` defaults to true), so the same form covers sign-up too.
 * Local mode never renders this — it only appears when real Supabase
 * credentials are configured. Once signed in, every user is walked through
 * mandatory TOTP enrollment/verification (see MfaEnrollScreen /
 * MfaChallengeScreen) before reaching the app.
 */
export function AuthScreen({ client, emailStorage }: AuthScreenProps) {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [magicLinkSent, setMagicLinkSent] = useState(false)
  // Previously used emails on this device, offered below the field as
  // click-to-fill suggestions — see recentEmailsStorage.ts for why: a typo'd
  // retype is exactly how someone ends up siloed in a brand new, empty
  // account instead of the shared one.
  const [recentEmails, setRecentEmails] = useState<string[]>(() => loadRecentEmails(emailStorage))
  const [showSuggestions, setShowSuggestions] = useState(false)
  const fieldRef = useRef<HTMLDivElement>(null)

  // Closes the suggestion list on a click anywhere outside the field.
  useEffect(() => {
    if (!showSuggestions) return
    const onPointerDown = (event: MouseEvent) => {
      if (!fieldRef.current?.contains(event.target as Node)) setShowSuggestions(false)
    }
    window.addEventListener('mousedown', onPointerDown)
    return () => window.removeEventListener('mousedown', onPointerDown)
  }, [showSuggestions])

  const matchingSuggestions = recentEmails.filter((saved) =>
    saved.toLowerCase().includes(email.trim().toLowerCase()),
  )

  const pickSuggestion = (value: string) => {
    setEmail(value)
    setShowSuggestions(false)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setBusy(true)

    const trimmed = email.trim()
    const { error } = await client.auth.signInWithOtp({
      email: trimmed,
      options: { emailRedirectTo: window.location.origin },
    })
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    setRecentEmails(addRecentEmail(trimmed, emailStorage))
    setMagicLinkSent(true)
  }

  if (magicLinkSent) {
    return (
      <div className="boot">
        <img src="/mark.svg" alt="" className="boot-mark" />
        <h1>Count<span className="brand-accent">Room</span></h1>
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
      <img src="/mark.svg" alt="" className="boot-mark" />
      <h1>Count<span className="brand-accent">Room</span></h1>
      <div className="panel" style={{ width: 'min(360px, 100%)', textAlign: 'left' }}>
        <h2>Sign in</h2>
        <form className="form" onSubmit={submit} noValidate>
          <div className="field email-field" ref={fieldRef}>
            <label htmlFor="auth-email">Email</label>
            <div className="email-input-wrap">
              <input
                id="auth-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  setShowSuggestions(true)
                }}
                onFocus={() => setShowSuggestions(true)}
                required
              />
              {/* Always-visible affordance for the remembered-emails list below, rather
                  than relying on someone noticing suggestions appear when they focus an
                  empty field — see recentEmailsStorage.ts for why picking a remembered
                  address matters here. */}
              {recentEmails.length > 0 && (
                <button
                  type="button"
                  className="email-dropdown-toggle"
                  aria-label="Show previously used emails"
                  aria-haspopup="listbox"
                  aria-expanded={showSuggestions}
                  onClick={() => setShowSuggestions((open) => !open)}
                >
                  <span aria-hidden="true">&#9662;</span>
                </button>
              )}
            </div>
            {showSuggestions && matchingSuggestions.length > 0 && (
              <ul className="email-suggestions" role="listbox" aria-label="Previously used addresses">
                {matchingSuggestions.map((saved) => (
                  <li key={saved}>
                    <button
                      type="button"
                      className="email-suggestion"
                      role="option"
                      aria-selected={saved === email}
                      onClick={() => pickSuggestion(saved)}
                    >
                      {saved}
                    </button>
                  </li>
                ))}
              </ul>
            )}
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
