import { describe, expect, it } from 'vitest'
import { resolveBackend } from './createRepository'

describe('resolveBackend', () => {
  it('uses localStorage when no credentials are configured', () => {
    expect(resolveBackend({})).toEqual({ kind: 'local' })
  })

  it('uses localStorage when only the url is set', () => {
    expect(resolveBackend({ VITE_SUPABASE_URL: 'https://x.supabase.co' })).toEqual({
      kind: 'local',
    })
  })

  it('uses localStorage when only the key is set', () => {
    expect(resolveBackend({ VITE_SUPABASE_ANON_KEY: 'anon' })).toEqual({ kind: 'local' })
  })

  it('ignores blank or placeholder credentials', () => {
    expect(
      resolveBackend({ VITE_SUPABASE_URL: '   ', VITE_SUPABASE_ANON_KEY: 'anon' }),
    ).toEqual({ kind: 'local' })
    expect(
      resolveBackend({
        VITE_SUPABASE_URL: 'your-project-url',
        VITE_SUPABASE_ANON_KEY: 'your-anon-key',
      }),
    ).toEqual({ kind: 'local' })
  })

  it('uses Supabase when both credentials are present', () => {
    expect(
      resolveBackend({
        VITE_SUPABASE_URL: ' https://x.supabase.co ',
        VITE_SUPABASE_ANON_KEY: ' anon-key ',
      }),
    ).toEqual({
      kind: 'supabase',
      url: 'https://x.supabase.co',
      anonKey: 'anon-key',
    })
  })
})
