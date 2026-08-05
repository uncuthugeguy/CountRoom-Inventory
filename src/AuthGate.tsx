import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { App } from './App'
import { AuthScreen } from './ui/screens/AuthScreen'
import { getSupabaseClient } from './data/supabaseClient'

/** Values shipped in .env.example that must not be treated as real credentials. */
const PLACEHOLDERS = new Set([
  'your-project-url',
  'your-anon-key',
  'https://your-project-ref.supabase.co',
])

function configuredCredentials(): { url: string; anonKey: string } | null {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? ''
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? ''
  if (!url || !anonKey) return null
  if (PLACEHOLDERS.has(url) || PLACEHOLDERS.has(anonKey)) return null
  return { url, anonKey }
}

/**
 * Gates the app behind Supabase auth when cloud credentials are configured.
 * Local demo mode (no credentials) renders straight through, unchanged.
 */
export function AuthGate() {
  const credentials = configuredCredentials()
  if (!credentials) return <App />
  return <SupabaseGate url={credentials.url} anonKey={credentials.anonKey} />
}

function SupabaseGate({ url, anonKey }: { url: string; anonKey: string }) {
  const client = getSupabaseClient(url, anonKey)
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    client.auth.getSession().then(({ data }) => {
      if (!cancelled) setSession(data.session)
    })
    const { data: listener } = client.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
    })
    return () => {
      cancelled = true
      listener.subscription.unsubscribe()
    }
  }, [client])

  if (session === undefined) {
    return (
      <div className="boot">
        <h1>StockFlow</h1>
        <p className="muted" role="status">
          Checking your sign-in…
        </p>
      </div>
    )
  }

  if (!session) return <AuthScreen client={client} />

  return <App onSignOut={() => client.auth.signOut()} />
}
