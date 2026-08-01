import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { createLocalRepository } from './data/localRepository'
import type { InventoryRepository } from './data/repository'
import { memoryStorage } from './test/memoryStorage'

let createObjectURL: ReturnType<typeof vi.fn>

beforeEach(() => {
  createObjectURL = vi.fn(() => 'blob:stockflow')
  Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true })
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})

/** Renders the app against a fresh offline store holding the demo catalogue. */
async function renderApp(repo?: InventoryRepository) {
  const repository = repo ?? createLocalRepository({ storage: memoryStorage(), seed: true })
  const user = userEvent.setup()
  render(<App openRepository={async () => repository} />)
  await screen.findByTestId('stat-products')
  return { user, repository }
}

const go = async (user: ReturnType<typeof userEvent.setup>, tab: RegExp) => {
  await user.click(within(screen.getByRole('navigation')).getByRole('button', { name: tab }))
}

/**
 * Replays a HID wedge scan: a burst of keystrokes ending in Enter, with a fixed
 * timestamp so the burst is never mistaken for slow human typing.
 */
function wedgeScan(barcode: string) {
  act(() => {
    for (const key of [...barcode, 'Enter']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      Object.defineProperty(event, 'timeStamp', { value: 0 })
      window.dispatchEvent(event)
    }
  })
}

describe('dashboard', () => {
  it('summarises the catalogue on load', async () => {
    await renderApp()

    expect(screen.getByTestId('stat-products')).toHaveTextContent('8')
    expect(screen.getByTestId('stat-units')).toHaveTextContent('809')
    expect(screen.getByTestId('stat-low-stock')).toHaveTextContent('3')
    expect(screen.getByTestId('stat-out-of-stock')).toHaveTextContent('1')
  })

  it('lists the lines that need reordering', async () => {
    await renderApp()

    const lowStock = within(screen.getByTestId('low-stock-list')).getAllByRole('listitem')
    expect(lowStock).toHaveLength(3)
    expect(lowStock[0]).toHaveTextContent('M6 Flat Washer')
  })

  it('names the active backend so it is obvious the app is running offline', async () => {
    await renderApp()
    expect(screen.getByTestId('backend-badge')).toHaveTextContent(/offline/i)
  })

  it('shows a readable error when the backend cannot be opened', async () => {
    render(<App openRepository={() => Promise.reject(new Error('Supabase unreachable'))} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Supabase unreachable')
  })
})

describe('products', () => {
  it('filters the catalogue as the user searches', async () => {
    const { user } = await renderApp()
    await go(user, /products/i)
    expect(screen.getAllByTestId('product-row')).toHaveLength(8)

    await user.type(screen.getByLabelText(/search products/i), 'drill')

    const rows = screen.getAllByTestId('product-row')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('Cordless Drill 18V')
  })

  it('tells the user when a search matches nothing', async () => {
    const { user } = await renderApp()
    await go(user, /products/i)

    await user.type(screen.getByLabelText(/search products/i), 'zzzz')

    expect(screen.queryAllByTestId('product-row')).toHaveLength(0)
    expect(screen.getByText(/no products match/i)).toBeInTheDocument()
  })

  it('creates a product and counts it on the dashboard', async () => {
    const { user } = await renderApp()
    await go(user, /products/i)
    await user.click(screen.getByRole('button', { name: /new product/i }))

    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText(/^barcode$/i), '1234567890128')
    await user.type(within(dialog).getByLabelText(/^sku$/i), 'HAM-500')
    await user.type(within(dialog).getByLabelText(/^name$/i), 'Claw Hammer 500g')
    await user.type(within(dialog).getByLabelText(/^category$/i), 'Hand Tools')
    await user.type(within(dialog).getByLabelText(/^location$/i), 'E1')
    await user.clear(within(dialog).getByLabelText(/^quantity$/i))
    await user.type(within(dialog).getByLabelText(/^quantity$/i), '6')
    await user.clear(within(dialog).getByLabelText(/reorder level/i))
    await user.type(within(dialog).getByLabelText(/reorder level/i), '2')
    await user.click(within(dialog).getByRole('button', { name: /save product/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByText('Claw Hammer 500g')).toBeInTheDocument()

    await go(user, /dashboard/i)
    expect(screen.getByTestId('stat-products')).toHaveTextContent('9')
  })

  it('keeps the dialog open and explains why an invalid draft was rejected', async () => {
    const { user } = await renderApp()
    await go(user, /products/i)
    await user.click(screen.getByRole('button', { name: /new product/i }))

    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText(/^barcode$/i), '999')
    await user.click(within(dialog).getByRole('button', { name: /save product/i }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/sku is required/i)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('refuses a barcode that another product already uses', async () => {
    const { user } = await renderApp()
    await go(user, /products/i)
    await user.click(screen.getByRole('button', { name: /new product/i }))

    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText(/^barcode$/i), '5012345678900')
    await user.type(within(dialog).getByLabelText(/^sku$/i), 'DUP-1')
    await user.type(within(dialog).getByLabelText(/^name$/i), 'Duplicate')
    await user.click(within(dialog).getByRole('button', { name: /save product/i }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/already used/i)
  })

  it('edits an existing product', async () => {
    const { user } = await renderApp()
    await go(user, /products/i)
    await user.click(screen.getByRole('button', { name: /edit m6 flat washer/i }))

    const dialog = screen.getByRole('dialog')
    const name = within(dialog).getByLabelText(/^name$/i)
    await user.clear(name)
    await user.type(name, 'M6 Washer (zinc)')
    await user.click(within(dialog).getByRole('button', { name: /save product/i }))

    expect(await screen.findByText('M6 Washer (zinc)')).toBeInTheDocument()
  })

  it('deletes a product only after the user confirms', async () => {
    const { user } = await renderApp()
    await go(user, /products/i)

    await user.click(screen.getByRole('button', { name: /delete m6 nyloc nut/i }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /cancel/i }))
    expect(screen.getByText('M6 Nyloc Nut')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /delete m6 nyloc nut/i }))
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: /^delete$/i }),
    )

    await waitFor(() => expect(screen.queryByText('M6 Nyloc Nut')).toBeNull())
  })

  it('exports the visible catalogue as csv', async () => {
    const { user } = await renderApp()
    await go(user, /products/i)
    await user.type(screen.getByLabelText(/search products/i), 'drill')

    await user.click(screen.getByRole('button', { name: /export products csv/i }))

    const blob = createObjectURL.mock.calls[0][0] as Blob
    const text = await blob.text()
    expect(text).toContain('Barcode,SKU,Name,Category,Location,Quantity,Reorder Level')
    expect(text).toContain('Cordless Drill 18V')
    expect(text).not.toContain('M6 Flat Washer')
  })
})

describe('stock movements', () => {
  it('takes stock out and writes the change to the history', async () => {
    const { user } = await renderApp()
    await go(user, /products/i)

    await user.click(screen.getByRole('button', { name: /stock out m6 flat washer/i }))
    const dialog = screen.getByRole('dialog')
    await user.clear(within(dialog).getByLabelText(/quantity/i))
    await user.type(within(dialog).getByLabelText(/quantity/i), '4')
    await user.type(within(dialog).getByLabelText(/reason/i), 'Job 42')
    await user.click(within(dialog).getByRole('button', { name: /record movement/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const row = screen
      .getAllByTestId('product-row')
      .find((r) => r.textContent?.includes('M6 Flat Washer'))
    expect(row).toHaveTextContent('60')

    await go(user, /history/i)
    const entries = screen.getAllByTestId('movement-row')
    expect(entries[0]).toHaveTextContent('M6 Flat Washer')
    expect(entries[0]).toHaveTextContent('Job 42')
    expect(entries[0]).toHaveTextContent('-4')
  })

  it('adds stock in', async () => {
    const { user } = await renderApp()
    await go(user, /products/i)

    await user.click(screen.getByRole('button', { name: /stock in nitrile gloves/i }))
    const dialog = screen.getByRole('dialog')
    await user.clear(within(dialog).getByLabelText(/quantity/i))
    await user.type(within(dialog).getByLabelText(/quantity/i), '25')
    await user.click(within(dialog).getByRole('button', { name: /record movement/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const row = screen
      .getAllByTestId('product-row')
      .find((r) => r.textContent?.includes('Nitrile Gloves'))
    expect(row).toHaveTextContent('25')
  })

  it('sets an absolute count when adjusting after a stocktake', async () => {
    const { user } = await renderApp()
    await go(user, /products/i)

    await user.click(screen.getByRole('button', { name: /adjust battery pack/i }))
    const dialog = screen.getByRole('dialog')
    await user.clear(within(dialog).getByLabelText(/quantity/i))
    await user.type(within(dialog).getByLabelText(/quantity/i), '9')
    await user.click(within(dialog).getByRole('button', { name: /record movement/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await go(user, /history/i)
    expect(screen.getAllByTestId('movement-row')[0]).toHaveTextContent('+7')
  })

  it('refuses to oversell and keeps the dialog open with the reason', async () => {
    const { user } = await renderApp()
    await go(user, /products/i)

    await user.click(screen.getByRole('button', { name: /stock out battery pack/i }))
    const dialog = screen.getByRole('dialog')
    await user.clear(within(dialog).getByLabelText(/quantity/i))
    await user.type(within(dialog).getByLabelText(/quantity/i), '99')
    await user.click(within(dialog).getByRole('button', { name: /record movement/i }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/only 2 in stock/i)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

describe('history', () => {
  it('reads empty until stock moves', async () => {
    const { user } = await renderApp()
    await go(user, /history/i)
    expect(screen.getByText(/no stock movements yet/i)).toBeInTheDocument()
  })

  it('exports the movement history as csv with product names resolved', async () => {
    const { user } = await renderApp()
    await go(user, /products/i)
    await user.click(screen.getByRole('button', { name: /stock in nitrile gloves/i }))
    const dialog = screen.getByRole('dialog')
    await user.clear(within(dialog).getByLabelText(/quantity/i))
    await user.type(within(dialog).getByLabelText(/quantity/i), '25')
    await user.click(within(dialog).getByRole('button', { name: /record movement/i }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    await go(user, /history/i)
    await user.click(screen.getByRole('button', { name: /export history csv/i }))

    const blob = createObjectURL.mock.calls.at(-1)![0] as Blob
    const text = await blob.text()
    expect(text).toContain('Timestamp,Product,Type,Quantity,Delta,Previous,New,Reason')
    expect(text).toContain('Nitrile Gloves (L)')
  })
})

describe('scanning', () => {
  it('jumps to the scan screen and opens the matching product on a wedge scan', async () => {
    await renderApp()

    wedgeScan('4006381333931')

    expect(await screen.findByTestId('scan-match')).toHaveTextContent('Cordless Drill 18V')
    expect(screen.getByRole('button', { name: /^scan$/i })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('offers to create a product when a scanned barcode is unknown', async () => {
    const { user } = await renderApp()

    wedgeScan('0000000000000')

    expect(await screen.findByText(/no product matches/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /add this product/i }))

    expect(within(screen.getByRole('dialog')).getByLabelText(/^barcode$/i)).toHaveValue(
      '0000000000000',
    )
  })

  it('looks a barcode up from the manual entry field', async () => {
    const { user } = await renderApp()
    await go(user, /scan/i)

    await user.type(screen.getByLabelText(/enter a barcode/i), '0075678164125')
    await user.click(screen.getByRole('button', { name: /look up/i }))

    expect(await screen.findByTestId('scan-match')).toHaveTextContent('Masking Tape 19mm')
  })

  it('records stock straight from a scan result', async () => {
    const { user } = await renderApp()
    await go(user, /scan/i)
    await user.type(screen.getByLabelText(/enter a barcode/i), '4006381333931')
    await user.click(screen.getByRole('button', { name: /look up/i }))
    await screen.findByTestId('scan-match')

    await user.click(screen.getByRole('button', { name: /stock out cordless drill/i }))
    const dialog = screen.getByRole('dialog')
    await user.clear(within(dialog).getByLabelText(/quantity/i))
    await user.type(within(dialog).getByLabelText(/quantity/i), '2')
    await user.click(within(dialog).getByRole('button', { name: /record movement/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByTestId('scan-match')).toHaveTextContent('5')
  })

  it('ignores wedge keystrokes while the user is typing in a field', async () => {
    const { user } = await renderApp()
    await go(user, /products/i)

    const search = screen.getByLabelText(/search products/i)
    await user.click(search)
    await user.type(search, '4006381333931{Enter}')

    expect(screen.getByLabelText(/search products/i)).toHaveValue('4006381333931')
    expect(screen.queryByTestId('scan-match')).toBeNull()
  })
})
