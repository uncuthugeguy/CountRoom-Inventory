import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { MfaChallengeScreen } from './MfaChallengeScreen'

function mockClient(overrides: Record<string, unknown> = {}): SupabaseClient {
  return {
    auth: {
      mfa: {
        challenge: vi.fn(async () => ({ data: { id: 'challenge-1' }, error: null })),
        verify: vi.fn(async () => ({ data: {}, error: null })),
        ...overrides,
      },
    },
  } as unknown as SupabaseClient
}

describe('MfaChallengeScreen', () => {
  it('verifies the entered code against the existing factor', async () => {
    const client = mockClient()
    const onVerified = vi.fn()
    const user = userEvent.setup()
    render(
      <MfaChallengeScreen client={client} factorId="factor-1" onVerified={onVerified} onSignOut={vi.fn()} />,
    )

    await user.type(screen.getByLabelText(/6-digit code/i), '654321')
    await user.click(screen.getByRole('button', { name: /^verify$/i }))

    expect(client.auth.mfa.challenge).toHaveBeenCalledWith({ factorId: 'factor-1' })
    expect(client.auth.mfa.verify).toHaveBeenCalledWith({
      factorId: 'factor-1',
      challengeId: 'challenge-1',
      code: '654321',
    })
    await vi.waitFor(() => expect(onVerified).toHaveBeenCalled())
  })

  it('shows a readable error on a wrong code', async () => {
    const client = mockClient({
      verify: vi.fn(async () => ({ error: { message: 'Invalid code' } })),
    })
    const user = userEvent.setup()
    render(
      <MfaChallengeScreen client={client} factorId="factor-1" onVerified={vi.fn()} onSignOut={vi.fn()} />,
    )

    await user.type(screen.getByLabelText(/6-digit code/i), '000000')
    await user.click(screen.getByRole('button', { name: /^verify$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid code')
  })

  it('lets the user sign out instead of entering a code', async () => {
    const client = mockClient()
    const onSignOut = vi.fn()
    const user = userEvent.setup()
    render(
      <MfaChallengeScreen client={client} factorId="factor-1" onVerified={vi.fn()} onSignOut={onSignOut} />,
    )

    await user.click(screen.getByRole('button', { name: /sign out/i }))
    expect(onSignOut).toHaveBeenCalled()
  })
})
