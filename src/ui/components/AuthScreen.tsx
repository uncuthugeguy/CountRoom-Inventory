import { useState, type FormEvent } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface AuthScreenProps {
  client: SupabaseClient
}

type Mode = 'signIn' | 'signUp' | 'forgot'

const TITLES: Record<Mode, string> = {
  signIn: 'Sign in',
  signUp: 'Create account',
  forgot: 'Reset your password',
}

const SUBMIT_LABELS: Record<Mode, string> = {
  signIn: 'Sign in',
  signUp: 'Create account',
  forgot: 'Send reset link',
}

const TOGGLE_LABELS: Record<Mode, string> = {
  signIn: 'Need an account? Sign up',
  signUp: 'Have an account? Sign in',
  forgot: 'Back to sign in',
}

/** Where the toggle link at the bottom of the form sends the user. */
const TOGGLE_TARGET: Record<Mode, Mode> = {
  signIn: 'signUp',
  signUp: 'signIn',
  forgot: 'signIn',
}

/**
 * Minimal email/password sign-in for Supabase mode, plus a "forgot password"
 * flow. Local mode never renders this — it only appears when real Supabase
 * credentials are configured.
 */
export function AuthScreen({ client }: AuthScreenProps) {
  const [mode, setMode] = useState<Mode>('signIn')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const switchMode = (next: Mode) => {
    setMode(next)
    setError(null)
    setInfo(null)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setInfo(null)
    setBusy(true)

    if (mode === 'forgot') {
      // Supabase sends this back through resetPasswordForEmail regardless of
      // whether the address has an account, so the message below never
      // confirms or denies that either.
      const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      })
      setBusy(false)
      if (error) {
        setError(error.message)
        return
      }
      setInfo('If that email has an account, a reset link is on its way — check your inbox.')
      return
    }

    const { error } =
      mode === 'signIn'
        ? await client.auth.signInWithPassword({ email, password })
        : await client.auth.signUp({ email, password })

    setBusy(false)

    if (error) {
      setError(error.message)
      return
    }

    if (mode === 'signUp') {
      setInfo('Account created. Check your email to confirm it, then sign in.')
      setMode('signIn')
    }
  }

  return (
    <div className="boot">
      <h1>StockFlow</h1>
      <div className="panel" style={{ width: 'min(360px, 100%)', textAlign: 'left' }}>
        <h2>{TITLES[mode]}</h2>
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

          {mode !== 'forgot' && (
            <div className="field">
              <label htmlFor="auth-password">Password</label>
              <input
                id="auth-password"
                type="password"
                autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
          )}

          {mode === 'signIn' && (
            <button type="button" className="link-button" onClick={() => switchMode('forgot')}>
              Forgot password?
            </button>
          )}

          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
          {info && <p className="preview">{info}</p>}

          <div className="dialog-actions">
            <button
              type="button"
              className="button button-ghost"
              onClick={() => switchMode(TOGGLE_TARGET[mode])}
            >
              {TOGGLE_LABELS[mode]}
            </button>
            <button type="submit" className="button button-primary" disabled={busy}>
              {busy ? 'Please wait…' : SUBMIT_LABELS[mode]}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
