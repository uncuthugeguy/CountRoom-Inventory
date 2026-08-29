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
  render(
    <App
      openRepository={async () => repository}
      settingsStorage={memoryStorage()}
      productDraftStorage={memoryStorage()}
      saleEditDraftStorage={memoryStorage()}
    />,
  )
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

  it('hides the profit-maker and dead-stock panels from an employee — same profit-sensitivity as the stat tile', async () => {
    await renderAs('employee')

    expect(screen.queryByRole('heading', { name: 'Buy more of this' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Not moving' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('dead-stock-list')).not.toBeInTheDocument()
  })

  it('shows the profit-maker and dead-stock panels for a manager', async () => {
    await renderAs('manager')

    expect(screen.getByRole('heading', { name: 'Buy more of this' })).toBeInTheDocument()
    expect(screen.getByTestId('dead-stock-list')).toBeInTheDocument()
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
    await user.click(screen.getByRole('button', { name: /^team$/i }))

    expect(await screen.findByRole('heading', { name: /^team$/i })).toBeInTheDocument()
    expect(screen.getByText(/^you\b/i)).toBeInTheDocument()
  })

  it('does not show a Product categories panel in settings', async () => {
    const { user } = await renderAs('employee')
    await go(user, /settings/i)
    await user.click(screen.getByRole('button', { name: /^catalogue$/i }))

    expect(screen.queryByRole('heading', { name: /product categories/i })).not.toBeInTheDocument()
  })

  it('shows a Product categories panel in settings for a manager', async () => {
    const { user } = await renderAs('manager')
    await go(user, /settings/i)
    await user.click(screen.getByRole('button', { name: /^catalogue$/i }))

    expect(await screen.findByRole('heading', { name: /product categories/i })).toBeInTheDocument()
  })

  it('offers only the manager-curated category list in the product form, not free text', async () => {
    const { user } = await renderAs('manager')
    await go(user, /settings/i)
    await user.click(screen.getByRole('button', { name: /^catalogue$/i }))

    const categoriesPanel = screen.getByRole('heading', { name: /product categories/i }).closest('section')!
    await user.type(within(categoriesPanel).getByLabelText(/add a category/i), 'Hand Tools')
    await user.click(within(categoriesPanel).getByRole('button', { name: /^add$/i }))

    await go(user, /products/i)
    await user.click(screen.getAllByRole('button', { name: /^edit /i })[0])

    const dialog = screen.getByRole('dialog')
    const categoryField = within(dialog).getByLabelText(/^category$/i)
    expect(categoryField.tagName).toBe('SELECT')
    expect(within(categoryField).getByRole('option', { name: 'Hand Tools' })).toBeInTheDocument()
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

  it('hides the Quick codes tab from an employee', async () => {
    await renderAs('employee')

    expect(within(screen.getByRole('navigation')).queryByRole('button', { name: /quick codes/i })).not.toBeInTheDocument()
  })

  it('shows the Quick codes tab for a manager', async () => {
    const { user } = await renderAs('manager')

    expect(within(screen.getByRole('navigation')).getByRole('button', { name: /quick codes/i })).toBeInTheDocument()
    await go(user, /quick codes/i)
    expect(await screen.findByText(/no codes saved yet/i)).toBeInTheDocument()
  })

  it('hides the Activity tab in History from an employee', async () => {
    const { user } = await renderAs('employee')
    await go(user, /history/i)

    expect(screen.queryByRole('button', { name: /^activity$/i })).not.toBeInTheDocument()
  })

  it('shows the Activity tab in History for a manager', async () => {
    const { user } = await renderAs('manager')
    await go(user, /history/i)

    expect(screen.getByRole('button', { name: /^activity$/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^activity$/i }))
    expect(await screen.findByText(/no activity yet/i)).toBeInTheDocument()
  })

  it('hides marketplace fees (and the profit they feed into) from an employee at checkout', async () => {
    const { user } = await renderAs('employee')
    await go(user, /checkout/i)

    expect(screen.queryByRole('heading', { name: /marketplace fees/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/est\. profit/i)).not.toBeInTheDocument()
  })

  it('shows marketplace fees to a manager at checkout', async () => {
    const { user } = await renderAs('manager')
    await go(user, /checkout/i)

    expect(screen.getByRole('heading', { name: /marketplace fees/i })).toBeInTheDocument()
    // Exact match — the paid-by toggle buttons below also have "buyer
    // protection fee" in their accessible name via aria-label.
    expect(screen.getByLabelText('Buyer protection fee')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /me paid the buyer protection fee/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /buyer paid the buyer protection fee/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/^vat$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/delivery cost/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /me paid for delivery/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /buyer paid for delivery/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/advertising cost/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/order total/i)).toBeInTheDocument()
  })
})
