import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { createLocalRepository } from './data/localRepository'
import type { InventoryRepository } from './data/repository'
import { memoryStorage } from './test/memoryStorage'

/**
 * Employee-role gating only ever kicks in once Supabase reports a real
 * second login (see repository.ts's Role doc comment) — the offline local
 * repository always reports 'manager'. To exercise the employee-facing UI
 * without standing up Supabase, this wraps the same local demo store and
 * overrides just the `role` it reports, leaving every read/write behind it
 * unchanged. That's enough to check what the UI shows and hides; the actual
 * server-side enforcement for a real employee is covered by
 * supabase/schema.sql and reviewed separately, since it can't run in this
 * test environment.
 */
function asEmployee(repo: InventoryRepository): InventoryRepository {
  return { ...repo, role: 'employee' }
}

beforeEach(() => {
  Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:stockflow'), configurable: true })
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})

async function renderAs(role: 'manager' | 'employee') {
  const base = createLocalRepository({ storage: memoryStorage(), seed: true })
  const repository = role === 'manager' ? base : asEmployee(base)
  const user = userEvent.setup()
  render(<App openRepository={async () => repository} settingsStorage={memoryStorage()} />)
  await screen.findByTestId('stat-products')
  return { user }
}

const go = async (user: ReturnType<typeof userEvent.setup>, tab: RegExp) => {
  await user.click(within(screen.getByRole('navigation')).getByRole('button', { name: tab }))
}

describe('employee role', () => {
  it('hides profit on the dashboard but keeps revenue', async () => {
    await renderAs('employee')

    expect(screen.queryByTestId('stat-profit-today')).not.toBeInTheDocument()
    expect(screen.getByTestId('stat-revenue-today')).toBeInTheDocument()
  })

  it('shows profit on the dashboard for a manager', async () => {
    await renderAs('manager')

    expect(screen.getByTestId('stat-profit-today')).toBeInTheDocument()
  })

  it('hides the delete button and CSV export on the products screen', async () => {
    const { user } = await renderAs('employee')
    await go(user, /products/i)

    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /export products csv/i })).not.toBeInTheDocument()
    // Employees still manage the catalogue day to day.
    expect(screen.getByRole('button', { name: /new product/i })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^edit /i }).length).toBeGreaterThan(0)
  })

  it('shows the delete button and CSV export on the products screen for a manager', async () => {
    const { user } = await renderAs('manager')
    await go(user, /products/i)

    expect(screen.getAllByRole('button', { name: /^delete /i }).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /export products csv/i })).toBeInTheDocument()
  })

  it('locks cost and price out of the product edit form', async () => {
    const { user } = await renderAs('employee')
    await go(user, /products/i)
    await user.click(screen.getAllByRole('button', { name: /^edit /i })[0])

    expect(screen.queryByLabelText(/^cost$/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^price$/i)).not.toBeInTheDocument()
    expect(screen.getByText(/cost and price are set by a manager/i)).toBeInTheDocument()
  })

  it('does not show a Team panel in settings', async () => {
    const { user } = await renderAs('employee')
    await go(user, /settings/i)

    expect(screen.queryByRole('heading', { name: /^team$/i })).not.toBeInTheDocument()
  })

  it('shows a Team panel in settings for a manager', async () => {
    const { user } = await renderAs('manager')
    await go(user, /settings/i)

    expect(await screen.findByRole('heading', { name: /^team$/i })).toBeInTheDocument()
    expect(screen.getByText(/^you\b/i)).toBeInTheDocument()
  })

  it('disables the stocktake approve button', async () => {
    const { user } = await renderAs('employee')
    await go(user, /stocktake/i)

    const textbox = screen.getByLabelText(/scanned barcodes/i)
    await user.type(textbox, '5012345678917')
    await user.click(screen.getByRole('button', { name: /import count/i }))

    const approve = screen.queryByRole('button', { name: /approve/i })
    if (approve) expect(approve).toBeDisabled()
  })
})
