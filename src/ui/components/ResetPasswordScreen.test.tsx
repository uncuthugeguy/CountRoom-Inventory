import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ResetPasswordScreen } from './ResetPasswordScreen'

function mockClient(overrides: Record<string, unknown> = {}): SupabaseClient {
  return {
    auth: {
      updateUser: vi.fn(async () => ({ error: null })),
      ...overrides,
    },
  } as unknown as SupabaseClient
}

describe('ResetPasswordScreen', () => {
  it('saves a new password and signals completion', async () => {
    const client = mockClient()
    const onDone = vi.fn()
    const user = userEvent.setup()
    render(<ResetPasswordScreen client={client} onDone={onDone} />)

    await user.type(screen.getByLabelText(/^new password$/i), 'newpass123')
    await user.type(screen.getByLabelText(/confirm password/i), 'newpass123')
    await user.click(screen.getByRole('button', { name: /save new password/i }))

    expect(client.auth.updateUser).toHaveBeenCalledWith({ password: 'newpass123' })
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled())
  })

  it('rejects a password that is too short without calling Supabase', async () => {
    const client = mockClient()
    const user = userEvent.setup()
    render(<ResetPasswordScreen client={client} onDone={vi.fn()} />)

    await user.type(screen.getByLabelText(/^new password$/i), 'abc')
    await user.type(screen.getByLabelText(/confirm password/i), 'abc')
    await user.click(screen.getByRole('button', { name: /save new password/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/at least 6 characters/i)
    expect(client.auth.updateUser).not.toHaveBeenCalled()
  })

  it('rejects mismatched passwords without calling Supabase', async () => {
    const client = mockClient()
    const user = userEvent.setup()
    render(<ResetPasswordScreen client={client} onDone={vi.fn()} />)

    await user.type(screen.getByLabelText(/^new password$/i), 'password1')
    await user.type(screen.getByLabelText(/confirm password/i), 'password2')
    await user.click(screen.getByRole('button', { name: /save new password/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/do not match/i)
    expect(client.auth.updateUser).not.toHaveBeenCalled()
  })

  it('shows a readable error when the update fails', async () => {
    const client = mockClient({ updateUser: vi.fn(async () => ({ error: { message: 'Session expired' } })) })
    const user = userEvent.setup()
    render(<ResetPasswordScreen client={client} onDone={vi.fn()} />)

    await user.type(screen.getByLabelText(/^new password$/i), 'password1')
    await user.type(screen.getByLabelText(/confirm password/i), 'password1')
    await user.click(screen.getByRole('button', { name: /save new password/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Session expired')
  })
})
