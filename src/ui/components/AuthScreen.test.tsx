import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { AuthScreen } from './AuthScreen'
import { memoryStorage } from '../../test/memoryStorage'

function mockClient(overrides: Record<string, unknown> = {}): SupabaseClient {
  return {
    auth: {
      signInWithOtp: vi.fn(async () => ({ error: null })),
      ...overrides,
    },
  } as unknown as SupabaseClient
}

describe('AuthScreen', () => {
  it('shows only the magic-link form, with no password field anywhere', () => {
    render(<AuthScreen client={mockClient()} emailStorage={memoryStorage()} />)

    expect(screen.getByRole('heading', { name: /^sign in$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /send sign-in link/i })).toBeInTheDocument()
    expect(screen.queryByLabelText(/password/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /password/i })).toBeNull()
  })

  it('sends a magic link and shows the check-your-email screen', async () => {
    const client = mockClient()
    const user = userEvent.setup()
    render(<AuthScreen client={client} emailStorage={memoryStorage()} />)

    await user.type(screen.getByLabelText(/email/i), 'jane@example.com')
    await user.click(screen.getByRole('button', { name: /send sign-in link/i }))

    expect(client.auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'jane@example.com',
      options: { emailRedirectTo: window.location.origin },
    })
    expect(await screen.findByText(/check jane@example.com for a sign-in link/i)).toBeInTheDocument()
  })

  it('shows a readable error when sending the magic link fails', async () => {
    const client = mockClient({
      signInWithOtp: vi.fn(async () => ({ error: { message: 'Too many requests' } })),
    })
    const user = userEvent.setup()
    render(<AuthScreen client={client} emailStorage={memoryStorage()} />)

    await user.type(screen.getByLabelText(/email/i), 'jane@example.com')
    await user.click(screen.getByRole('button', { name: /send sign-in link/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many requests')
  })

  it('lets you go back and try a different email after sending a magic link', async () => {
    const client = mockClient()
    const user = userEvent.setup()
    render(<AuthScreen client={client} emailStorage={memoryStorage()} />)

    await user.type(screen.getByLabelText(/email/i), 'jane@example.com')
    await user.click(screen.getByRole('button', { name: /send sign-in link/i }))
    await screen.findByText(/check jane@example.com for a sign-in link/i)

    await user.click(screen.getByRole('button', { name: /use a different email/i }))

    expect(screen.getByRole('button', { name: /send sign-in link/i })).toBeInTheDocument()
  })

  it('signing up is the same as signing in — the same form handles a brand new email', async () => {
    const client = mockClient()
    const user = userEvent.setup()
    render(<AuthScreen client={client} emailStorage={memoryStorage()} />)

    await user.type(screen.getByLabelText(/email/i), 'new@example.com')
    await user.click(screen.getByRole('button', { name: /send sign-in link/i }))

    // No separate sign-up mode/fields exist — signInWithOtp creates the
    // account automatically the first time an email is used.
    expect(client.auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'new@example.com',
      options: { emailRedirectTo: window.location.origin },
    })
    expect(await screen.findByText(/check new@example.com for a sign-in link/i)).toBeInTheDocument()
  })

  it('offers a previously used email as a click-to-fill suggestion instead of retyping it', async () => {
    const storage = memoryStorage()
    storage.setItem('stockflow.recentEmails.v1', JSON.stringify(['jane@example.com']))
    const user = userEvent.setup()
    render(<AuthScreen client={mockClient()} emailStorage={storage} />)

    await user.click(screen.getByLabelText(/email/i))
    await user.click(await screen.findByRole('option', { name: 'jane@example.com' }))

    expect(screen.getByLabelText(/email/i)).toHaveValue('jane@example.com')
  })

  it('remembers an email after a successful sign-in, for next time', async () => {
    const storage = memoryStorage()
    const client = mockClient()
    const user = userEvent.setup()
    render(<AuthScreen client={client} emailStorage={storage} />)

    await user.type(screen.getByLabelText(/email/i), 'jane@example.com')
    await user.click(screen.getByRole('button', { name: /send sign-in link/i }))
    await screen.findByText(/check jane@example.com for a sign-in link/i)

    expect(JSON.parse(storage.getItem('stockflow.recentEmails.v1') ?? '[]')).toContain('jane@example.com')

    await user.click(screen.getByRole('button', { name: /use a different email/i }))
    await user.clear(screen.getByLabelText(/email/i))
    await user.click(screen.getByLabelText(/email/i))

    expect(await screen.findByRole('option', { name: 'jane@example.com' })).toBeInTheDocument()
  })
})
