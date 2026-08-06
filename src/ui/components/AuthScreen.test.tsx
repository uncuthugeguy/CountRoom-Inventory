import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { AuthScreen } from './AuthScreen'

function mockClient(overrides: Record<string, unknown> = {}): SupabaseClient {
  return {
    auth: {
      signInWithPassword: vi.fn(async () => ({ error: null })),
      signUp: vi.fn(async () => ({ error: null })),
      resetPasswordForEmail: vi.fn(async () => ({ error: null })),
      ...overrides,
    },
  } as unknown as SupabaseClient
}

describe('AuthScreen', () => {
  it('signs in with email and password', async () => {
    const client = mockClient()
    const user = userEvent.setup()
    render(<AuthScreen client={client} />)

    await user.type(screen.getByLabelText(/email/i), 'jane@example.com')
    await user.type(screen.getByLabelText(/^password$/i), 'hunter22')
    await user.click(screen.getByRole('button', { name: /^sign in$/i }))

    expect(client.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'jane@example.com',
      password: 'hunter22',
    })
  })

  it('shows a readable error when sign-in fails', async () => {
    const client = mockClient({
      signInWithPassword: vi.fn(async () => ({ error: { message: 'Invalid login credentials' } })),
    })
    const user = userEvent.setup()
    render(<AuthScreen client={client} />)

    await user.type(screen.getByLabelText(/email/i), 'jane@example.com')
    await user.type(screen.getByLabelText(/^password$/i), 'wrong')
    await user.click(screen.getByRole('button', { name: /^sign in$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid login credentials')
  })

  it('switches to the forgot-password form and hides the password field', async () => {
    const client = mockClient()
    const user = userEvent.setup()
    render(<AuthScreen client={client} />)

    await user.click(screen.getByRole('button', { name: /forgot password/i }))

    expect(screen.getByRole('heading', { name: /reset your password/i })).toBeInTheDocument()
    expect(screen.queryByLabelText(/^password$/i)).toBeNull()
  })

  it('sends a reset link without confirming whether the account exists', async () => {
    const client = mockClient()
    const user = userEvent.setup()
    render(<AuthScreen client={client} />)

    await user.click(screen.getByRole('button', { name: /forgot password/i }))
    await user.type(screen.getByLabelText(/email/i), 'jane@example.com')
    await user.click(screen.getByRole('button', { name: /send reset link/i }))

    expect(client.auth.resetPasswordForEmail).toHaveBeenCalledWith('jane@example.com', {
      redirectTo: window.location.origin,
    })
    expect(await screen.findByText(/reset link is on its way/i)).toBeInTheDocument()
  })

  it('shows a readable error when the reset request fails', async () => {
    const client = mockClient({
      resetPasswordForEmail: vi.fn(async () => ({ error: { message: 'Too many requests' } })),
    })
    const user = userEvent.setup()
    render(<AuthScreen client={client} />)

    await user.click(screen.getByRole('button', { name: /forgot password/i }))
    await user.type(screen.getByLabelText(/email/i), 'jane@example.com')
    await user.click(screen.getByRole('button', { name: /send reset link/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many requests')
  })

  it('returns to sign in from the forgot-password form', async () => {
    const client = mockClient()
    const user = userEvent.setup()
    render(<AuthScreen client={client} />)

    await user.click(screen.getByRole('button', { name: /forgot password/i }))
    await user.click(screen.getByRole('button', { name: /back to sign in/i }))

    expect(screen.getByRole('heading', { name: /^sign in$/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument()
  })

  it('creates an account and prompts sign-in afterwards', async () => {
    const client = mockClient()
    const user = userEvent.setup()
    render(<AuthScreen client={client} />)

    await user.click(screen.getByRole('button', { name: /need an account/i }))
    await user.type(screen.getByLabelText(/email/i), 'new@example.com')
    await user.type(screen.getByLabelText(/^password$/i), 'hunter22')
    await user.click(screen.getByRole('button', { name: /^create account$/i }))

    expect(client.auth.signUp).toHaveBeenCalledWith({ email: 'new@example.com', password: 'hunter22' })
    expect(await screen.findByText(/check your email to confirm/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /^sign in$/i })).toBeInTheDocument()
  })
})
