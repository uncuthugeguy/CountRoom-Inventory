import { createLocalRepository } from './localRepository'
import type { InventoryRepository } from './repository'

export interface RepositoryEnv {
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_ANON_KEY?: string
}

export type Backend =
  | { kind: 'local' }
  | { kind: 'supabase'; url: string; anonKey: string }

/** Values shipped in .env.example that must not be treated as real credentials. */
const PLACEHOLDERS = new Set([
  'your-project-url',
  'your-anon-key',
  'https://your-project-ref.supabase.co',
])

/**
 * Supabase is used only when both credentials are genuinely present, so a
 * clone with no .env still boots straight into the offline demo store.
 */
export function resolveBackend(env: RepositoryEnv): Backend {
  const url = env.VITE_SUPABASE_URL?.trim() ?? ''
  const anonKey = env.VITE_SUPABASE_ANON_KEY?.trim() ?? ''

  if (!url || !anonKey) return { kind: 'local' }
  if (PLACEHOLDERS.has(url) || PLACEHOLDERS.has(anonKey)) return { kind: 'local' }

  return { kind: 'supabase', url, anonKey }
}

/**
 * Builds the live repository. The Supabase adapter is imported lazily so the
 * default offline build never pulls the client into the main bundle.
 */
export async function createRepository(env: RepositoryEnv): Promise<InventoryRepository> {
  const backend = resolveBackend(env)
  if (backend.kind === 'local') return createLocalRepository()

  const { createSupabaseRepository } = await import('./supabaseRepository')
  return createSupabaseRepository(backend.url, backend.anonKey)
}
