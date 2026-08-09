import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { MfaEnrollScreen } from './MfaEnrollScreen'

function mockClient(overrides: Record<string, unknown> = {}): SupabaseClient {
  return {
    auth: {
      mfa: {
        listFactors: vi.fn(async () => ({ data: { all: [], totp: [] }, error: null })),
        unenroll: vi.fn(async () => ({ error: null })),
        enroll: vi.fn(async () => ({
          data: { id: 'factor-1', totp: { qr_code: '<svg>qr</svg>', secret: 'SECRET123' } },
          error: null,
        })),
        challenge: vi.fn(async () => ({ data: { id: 'challenge-1' }, error: null })),
        verify: vi.fn(async () => ({ data: {}, error: null })),
        ...overrides,
      },
    },
  } as unknown as SupabaseClient
}

describe('MfaEnrollScreen', () => {
  it('starts enrollment, shows the QR code and secret, and verifies a code', async () => {
    const client = mockClient()
    const onEnrolled = vi.fn()
    const user = userEvent.setup()
    render(<MfaEnrollScreen client={client} onEnrolled={onEnrolled} />)

    expect(await screen.findByText('SECRET123')).toBeInTheDocument()
    expect(client.auth.mfa.enroll).toHaveBeenCalledWith({ factorType: 'totp' })

    await user.type(screen.getByLabelText(/6-digit code/i), '123456')
    await user.click(screen.getByRole('button', { name: /verify and continue/i }))

    expect(client.auth.mfa.challenge).toHaveBeenCalledWith({ factorId: 'factor-1' })
    expect(client.auth.mfa.verify).toHaveBeenCalledWith({
      factorId: 'factor-1',
      challengeId: 'challenge-1',
      code: '123456',
    })
    await vi.waitFor(() => expect(onEnrolled).toHaveBeenCalled())
  })

  it('clears a stale unverified factor before enrolling a new one', async () => {
    const client = mockClient({
      listFactors: vi.fn(async () => ({
        data: { all: [{ id: 'old-factor', factor_type: 'totp', status: 'unverified' }], totp: [] },
        error: null,
      })),
    })
    render(<MfaEnrollScreen client={client} onEnrolled={vi.fn()} />)

    await screen.findByText('SECRET123')
    expect(client.auth.mfa.unenroll).toHaveBeenCalledWith({ factorId: 'old-factor' })
  })

  it('shows a readable error when the code is wrong', async () => {
    const client = mockClient({
      verify: vi.fn(async () => ({ error: { message: 'Invalid code' } })),
    })
    const user = userEvent.setup()
    render(<MfaEnrollScreen client={client} onEnrolled={vi.fn()} />)

    await screen.findByText('SECRET123')
    await user.type(screen.getByLabelText(/6-digit code/i), '000000')
    await user.click(screen.getByRole('button', { name: /verify and continue/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid code')
  })
})
