import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { createLocalRepository } from './data/localRepository'
import { DUPLICATE_SKU, type InventoryRepository, type TeamMember } from './data/repository'
import { memoryStorage } from './test/memoryStorage'
import type { ActivityLogEntry, Product } from './domain/types'

/**
 * A repository double that simulates the exact failure mode reported by
 * users: the auto-picked SKU was computed from a catalogue snapshot that
 * predates a product another session already saved under that same SKU. The
 * conflicting product only becomes visible once the app reloads after the
 * collision, mirroring the offline-first repo having no real-time sync.
 */
function buildStaleSkuRepo(): InventoryRepository {
  const conflicting: Product = {
    id: 'elsewhere',
    barcode: '',
    sku: 'SKU-001',
    name: 'Added on another device',
    category: '',
    location: '',
    variation: '',
    quantity: 1,
    reorderLevel: 0,
    cost: 1,
    price: 1,
    createdAt: 't',
    updatedAt: 't',
  }
  const saved: Product[] = []
  let revealed = false

  return {
    kind: 'local',
    role: 'manager',
    async listProducts() {
      return revealed ? [conflicting, ...saved] : []
    },
    async listMovements() {
      return []
    },
    async createProduct(draft) {
      if (draft.sku === conflicting.sku) {
        revealed = true
        return { ok: false, error: DUPLICATE_SKU }
      }
      const product: Product = { ...draft, id: `p${saved.length + 1}`, createdAt: 't', updatedAt: 't' }
      saved.push(product)
      return { ok: true, value: product }
    },
    updateProduct: vi.fn(),
    deleteProduct: vi.fn(),
    recordMovement: vi.fn(),
    async listSales() {
      return []
    },
    recordSale: vi.fn(),
    updateSale: vi.fn(),
    async listReturns() {
      return []
    },
    recordReturn: vi.fn(),
    updateReturn: vi.fn(),
    async listTeam() {
      return [{ id: 'you', email: 'You', role: 'manager' as const, status: 'active' as const, isYou: true }]
    },
    inviteEmployee: vi.fn(),
    removeTeamMember: vi.fn(),
    async getProfile() {
      return { fullName: '', birthday: '', address: '', employeeNumber: '', username: '', updatedAt: 't' }
    },
    updateProfile: vi.fn(),
    async listPendingProfileChanges() {
      return []
    },
    approveProfileChange: vi.fn(),
    rejectProfileChange: vi.fn(),
    async getLoginEmail() {
      return ''
    },
    updateLoginEmail: vi.fn(),
    async getAccountSettings() {
      return null
    },
    setAccountSettings: vi.fn(),
    listSuppliers: vi.fn(async () => []),
    createSupplier: vi.fn(),
    updateSupplier: vi.fn(),
    deleteSupplier: vi.fn(),
    linkSupplierProduct: vi.fn(),
    updateSupplierProduct: vi.fn(),
    unlinkSupplierProduct: vi.fn(),
    listSupplierProducts: vi.fn(async () => []),
    listPurchaseOrders: vi.fn(async () => []),
    createPurchaseOrder: vi.fn(),
    sendPurchaseOrder: vi.fn(),
    confirmPurchaseOrder: vi.fn(),
    receivePurchaseOrder: vi.fn(),
    cancelPurchaseOrder: vi.fn(),
    async listActivity() {
      return []
    },
    logActivity: vi.fn(),
  }
}

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
  render(
    <App
      openRepository={async () => repository}
      settingsStorage={memoryStorage()}
      productDraftStorage={memoryStorage()}
      saleEditDraftStorage={memoryStorage()}
      supplierDraftStorage={memoryStorage()}
      purchaseOrderDraftStorage={memoryStorage()}
    />,
  )
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
    render(
      <App
        openRepository={() => Promise.reject(new Error('Supabase unreachable'))}
        settingsStorage={memoryStorage()}
      />,
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('Supabase unreachable')
  })

  it('flags the untouched demo catalogue as not moving, since none of it has ever sold', async () => {
    await renderApp()

    const notMoving = screen.getByTestId('dead-stock-list')
    // Every seeded product predates the 60-day dead-stock threshold and none
    // of them has a recorded sale, so the whole (in-stock) catalogue shows up.
    expect(within(notMoving).getAllByRole('listitem').length).toBeGreaterThan(0)
    expect(notMoving).toHaveTextContent('Never sold')
  })

  it('surfaces a product that just sold as a top profit maker, not as dead stock', async () => {
    const { user } = await renderApp()
    await go(user, /checkout/i)

    // M6 Flat Washer: cost 0.01, price 0.05 → 0.04 profit.
    await user.type(screen.getByLabelText(/enter a barcode or sku/i), '5012345678917')
    await user.click(screen.getByRole('button', { name: /add to sale/i }))
    await screen.findByTestId('cart-row')
    await user.click(screen.getByRole('button', { name: 'eBay' }))
    await user.type(screen.getByLabelText(/cash received/i), '1')
    await user.click(screen.getByRole('button', { name: /complete sale/i }))
    await waitFor(() => expect(screen.queryByTestId('cart-row')).toBeNull())

    await go(user, /dashboard/i)

    const topPerformers = screen.getByTestId('top-performers-list')
    expect(topPerformers).toHaveTextContent('M6 Flat Washer')
    expect(topPerformers).toHaveTextContent('0.04 profit')
    expect(topPerformers).toHaveTextContent('1 sold')

    const notMoving = screen.getByTestId('dead-stock-list')
    expect(within(notMoving).queryByText('M6 Flat Washer')).not.toBeInTheDocument()
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
    await user.type(within(dialog).getByLabelText(/^barcode/i), '1234567890128')
    await user.type(within(dialog).getByLabelText(/^sku$/i), 'HAM-500')
    await user.type(within(dialog).getByLabelText(/^name$/i), 'Claw Hammer 500g')
    // Category is a manager-curated dropdown, not free text (see
    // ProductFormDialog) — pick one already in use by the demo catalogue
    // rather than typing a new one.
    await user.selectOptions(within(dialog).getByLabelText(/^category$/i), 'Power Tools')
    await user.type(within(dialog).getByLabelText(/^location$/i), 'E1')
    await user.clear(within(dialog).getByLabelText(/^quantity$/i))
    await user.type(within(dialog).getByLabelText(/^quantity$/i), '6')
    await user.clear(within(dialog).getByLabelText(/reorder level/i))
    await user.type(within(dialog).getByLabelText(/reorder level/i), '2')
    await user.click(within(dialog).getByRole('button', { name: /save product/i }))

    // Saving asks for confirmation first rather than saving immediately —
    // see the next test for the point of this.
    expect(await within(dialog).findByText(/save "claw hammer 500g" as a new product/i)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: /yes, save/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByText('Claw Hammer 500g')).toBeInTheDocument()

    await go(user, /dashboard/i)
    expect(screen.getByTestId('stat-products')).toHaveTextContent('9')
  })

  it('asks for confirmation before saving instead of saving immediately, so pressing Enter in an earlier field cannot accidentally save and close the dialog', async () => {
    const { user } = await renderApp()
    await go(user, /products/i)
    await user.click(screen.getByRole('button', { name: /new product/i }))

    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText(/^name$/i), 'Claw Hammer 500g')
    // Pressing Enter in a field submits the form the same way clicking Save
    // does — this used to save and close immediately.
    await user.type(within(dialog).getByLabelText(/^name$/i), '{Enter}')

    // Still open, now showing a confirmation instead of having saved.
    expect(await within(dialog).findByText(/save "claw hammer 500g" as a new product/i)).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    // Backing out returns to the form with nothing lost and nothing saved.
    await user.click(within(dialog).getByRole('button', { name: /^back$/i }))
    expect(within(dialog).getByLabelText(/^name$/i)).toHaveValue('Claw Hammer 500g')
    expect(screen.queryByText('Claw Hammer 500g')).not.toBeInTheDocument()
  })

  it('keeps the dialog open and explains why an invalid draft was rejected', async () => {
    const { user } = await renderApp()
    await go(user, /products/i)
    await user.click(screen.getByRole('button', { name: /new product/i }))

    const dialog = screen.getByRole('dialog')
    // SKU is auto-generated when left blank, so leaving name blank is what
    // trips validation here.
    await user.type(within(dialog).getByLabelText(/^barcode/i), '999')
    await user.click(within(dialog).getByRole('button', { name: /save product/i }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/name is required/i)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('auto-generates the next SKU in sequence when the field is left blank', async () => {
    const { user } = await renderApp()
    await go(user, /products/i)
    await user.click(screen.getByRole('button', { name: /new product/i }))

    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText(/^name$/i), 'Claw Hammer 500g')
    await user.click(within(dialog).getByRole('button', { name: /save product/i }))
    await user.click(within(dialog).getByRole('button', { name: /yes, save/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const row = screen
      .getAllByTestId('product-row')
      .find((r) => r.textContent?.includes('Claw Hammer 500g'))
    // None of the demo products follow the SKU-NNN pattern, so this is the first.
    expect(row).toHaveTextContent('SKU-001')
  })

  it('recovers when an auto-generated SKU collides with one added elsewhere, instead of just failing', async () => {
    const { user } = await renderApp(buildStaleSkuRepo())
    await go(user, /products/i)
    await user.click(screen.getByRole('button', { name: /new product/i }))

    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText(/^name$/i), 'Claw Hammer 500g')
    await user.click(within(dialog).getByRole('button', { name: /save product/i }))
    await user.click(within(dialog).getByRole('button', { name: /yes, save/i }))

    // No confusing "barcode already used" error, and no dialog left hanging
    // open — the app quietly regenerated the SKU and saved.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const row = screen
      .getAllByTestId('product-row')
      .find((r) => r.textContent?.includes('Claw Hammer 500g'))
    expect(row).toHaveTextContent('SKU-002')
  })

  it('refuses a barcode that another product already uses', async () => {
    const { user } = await renderApp()
    await go(user, /products/i)
    await user.click(screen.getByRole('button', { name: /new product/i }))

    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText(/^barcode/i), '5012345678900')
    await user.type(within(dialog).getByLabelText(/^sku$/i), 'DUP-1')
    await user.type(within(dialog).getByLabelText(/^name$/i), 'Duplicate')
    await user.click(within(dialog).getByRole('button', { name: /save product/i }))
    await user.click(within(dialog).getByRole('button', { name: /yes, save/i }))

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
    await user.click(within(dialog).getByRole('button', { name: /yes, save/i }))

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
    expect(text).toContain(
      'Barcode,SKU,Name,Category,Location,Variation,Quantity,Reorder Level,Cost,Price',
    )
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

  it('shows the full detail for a stock movement on click', async () => {
    const { user } = await renderApp()
    await go(user, /products/i)

    await user.click(screen.getByRole('button', { name: /stock out m6 flat washer/i }))
    const dialog = screen.getByRole('dialog')
    await user.clear(within(dialog).getByLabelText(/quantity/i))
    await user.type(within(dialog).getByLabelText(/quantity/i), '4')
    await user.type(within(dialog).getByLabelText(/reason/i), 'Job 42')
    await user.click(within(dialog).getByRole('button', { name: /record movement/i }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    await go(user, /history/i)
    const row = screen.getByTestId('movement-row')
    await user.click(within(row).getByRole('button', { name: /view details/i }))

    const detail = screen.getByRole('dialog')
    expect(detail).toHaveTextContent('M6 Flat Washer')
    expect(detail).toHaveTextContent('Job 42')
    expect(detail).toHaveTextContent('64 → 60')
  })
})

describe('activity log', () => {
  it('records an edit to a product and shows it, attributed, on the Activity tab', async () => {
    const { user } = await renderApp()
    await go(user, /products/i)
    await user.click(screen.getByRole('button', { name: /edit m6 flat washer/i }))

    const dialog = screen.getByRole('dialog')
    const quantity = within(dialog).getByLabelText(/^quantity$/i)
    await user.clear(quantity)
    await user.type(quantity, '50')
    await user.click(within(dialog).getByRole('button', { name: /save product/i }))
    await user.click(within(dialog).getByRole('button', { name: /yes, save/i }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    await go(user, /history/i)
    await user.click(screen.getByRole('button', { name: /^activity$/i }))

    const row = screen.getByTestId('activity-row')
    expect(row).toHaveTextContent('You')
    expect(row).toHaveTextContent('edited')
    expect(row).toHaveTextContent('M6 Flat Washer')
    expect(row).toHaveTextContent('qty 64 → 50')
  })

  it('records a newly added product and a deleted product too', async () => {
    const { user } = await renderApp()
    await go(user, /products/i)

    await user.click(screen.getByRole('button', { name: /new product/i }))
    let dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText(/^name$/i), 'Brand New Widget')
    await user.click(within(dialog).getByRole('button', { name: /save product/i }))
    await user.click(within(dialog).getByRole('button', { name: /yes, save/i }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    await user.click(screen.getByRole('button', { name: /delete m6 nyloc nut/i }))
    dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /^delete$/i }))
    await waitFor(() => expect(screen.queryByText('M6 Nyloc Nut')).toBeNull())

    await go(user, /history/i)
    await user.click(screen.getByRole('button', { name: /^activity$/i }))

    const rows = screen.getAllByTestId('activity-row')
    const text = rows.map((r) => r.textContent).join(' | ')
    expect(text).toMatch(/added.*Brand New Widget/)
    expect(text).toMatch(/removed.*M6 Nyloc Nut/)
  })

  it('does not log a save that changed nothing tracked', async () => {
    const { user } = await renderApp()
    await go(user, /products/i)
    await user.click(screen.getByRole('button', { name: /edit m6 flat washer/i }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /save product/i }))
    await user.click(within(dialog).getByRole('button', { name: /yes, save/i }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    await go(user, /history/i)
    await user.click(screen.getByRole('button', { name: /^activity$/i }))
    expect(screen.getByText(/no activity yet/i)).toBeInTheDocument()
  })

  it('records editing a past sale and shows it on the Activity tab', async () => {
    const { user } = await renderApp()
    await go(user, /checkout/i)

    await user.type(screen.getByLabelText(/enter a barcode or sku/i), '5012345678917')
    await user.click(screen.getByRole('button', { name: /add to sale/i }))
    await screen.findByTestId('cart-row')
    await user.click(screen.getByRole('button', { name: 'eBay' }))
    await user.type(screen.getByLabelText(/cash received/i), '1')
    await user.click(screen.getByRole('button', { name: /complete sale/i }))
    await screen.findByTestId('last-sale')

    await go(user, /history/i)
    await user.click(screen.getByRole('button', { name: /^sales$/i }))
    await user.click(screen.getByRole('button', { name: /view receipt/i }))
    const receipt = screen.getByRole('dialog')
    await user.click(within(receipt).getByRole('button', { name: /edit sale/i }))

    const editDialog = screen.getByRole('dialog')
    await user.click(within(editDialog).getByRole('button', { name: 'Vinted' }))
    await user.click(within(editDialog).getByRole('button', { name: /save changes/i }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    await user.click(screen.getByRole('button', { name: /^activity$/i }))
    const rows = screen.getAllByTestId('activity-row')
    const text = rows.map((r) => r.textContent).join(' | ')
    expect(text).toMatch(/edited.*Sale/)
    expect(text).toMatch(/channel eBay → Vinted/)
  })

  it('records editing a past return case and shows it on the Activity tab', async () => {
    const { user } = await renderApp()
    await go(user, /returns/i)

    await user.type(screen.getByLabelText(/search products to return/i), 'washer')
    await user.click(screen.getByRole('button', { name: /^add$/i }))
    await screen.findByTestId('return-cart-row')

    await user.click(screen.getByRole('button', { name: 'Refund' }))
    await user.type(screen.getByLabelText(/refund amount/i), '2.50')
    await user.type(screen.getByLabelText(/^channel$/i), 'eBay')
    await user.click(screen.getByRole('button', { name: /save case/i }))
    await screen.findByTestId('last-return')

    const row = screen.getByTestId('return-case-row')
    await user.click(within(row).getByRole('button', { name: /view details/i }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /edit case/i }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    const refundInput = screen.getByLabelText(/refund amount/i)
    await user.clear(refundInput)
    await user.type(refundInput, '5.00')
    await user.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() => expect(screen.queryByTestId('return-edit-banner')).toBeNull())

    await go(user, /history/i)
    await user.click(screen.getByRole('button', { name: /^activity$/i }))
    const rows = screen.getAllByTestId('activity-row')
    const text = rows.map((r) => r.textContent).join(' | ')
    expect(text).toMatch(/edited.*Return case/)
    expect(text).toMatch(/refund £2\.50 → £5\.00/)
  })
})

/**
 * The local repository doesn't support team accounts at all (see
 * repository.ts's TEAM_NOT_SUPPORTED), so exercising team-change activity
 * logging needs a small repo double that does — same technique
 * buildStaleSkuRepo above uses for a different edge case. Backed by a real
 * local repository underneath for everything else, so products/sales still
 * behave normally; only listTeam/inviteEmployee/removeTeamMember and the
 * activity log itself are overridden.
 */
function buildTeamCapableRepo(base: InventoryRepository): InventoryRepository {
  const activity: ActivityLogEntry[] = []
  let nextId = 1
  const team: TeamMember[] = [{ id: 'you', email: 'You', role: 'manager', status: 'active', isYou: true }]

  return {
    ...base,
    async listTeam() {
      return team
    },
    async inviteEmployee(email: string) {
      const member = { id: `m${nextId++}`, email, role: 'employee' as const, status: 'pending' as const, isYou: false, emailSent: true }
      team.push(member)
      activity.unshift({
        id: `a${nextId++}`,
        actorName: 'You',
        entityType: 'member',
        action: 'invited',
        entityId: member.id,
        entityLabel: email,
        detail: 'role: employee',
        createdAt: new Date().toISOString(),
      })
      return { ok: true, value: member }
    },
    async removeTeamMember(membershipId: string) {
      const idx = team.findIndex((m) => m.id === membershipId)
      if (idx === -1) return { ok: false, error: 'Not found.' }
      const [removed] = team.splice(idx, 1)
      activity.unshift({
        id: `a${nextId++}`,
        actorName: 'You',
        entityType: 'member',
        action: 'removed',
        entityId: membershipId,
        entityLabel: removed.email,
        detail: 'was employee',
        createdAt: new Date().toISOString(),
      })
      return { ok: true, value: true }
    },
    async listActivity() {
      // A fresh copy each call, same as the real repositories — proves the
      // Activity tab actually re-fetches after invite/remove rather than
      // happening to see a shared, in-place-mutated array.
      return [...activity]
    },
  }
}

describe('activity log — team changes', () => {
  it('records inviting and removing a team member, shown on the Activity tab for a manager', async () => {
    const repository = buildTeamCapableRepo(createLocalRepository({ storage: memoryStorage(), seed: true }))
    const { user } = await renderApp(repository)

    await go(user, /settings/i)
    await user.click(screen.getByRole('button', { name: /^team$/i }))
    await screen.findByRole('heading', { name: /^team$/i })
    await user.type(screen.getByLabelText(/invite an employee/i), 'jane@example.com')
    await user.click(screen.getByRole('button', { name: /^invite$/i }))
    await screen.findByText('jane@example.com')

    await go(user, /history/i)
    await user.click(screen.getByRole('button', { name: /^activity$/i }))
    let rows = screen.getAllByTestId('activity-row')
    expect(rows.map((r) => r.textContent).join(' | ')).toMatch(/invited.*jane@example\.com/)

    await go(user, /settings/i)
    await user.click(screen.getByRole('button', { name: /^team$/i }))
    await user.click(screen.getByRole('button', { name: /remove jane@example\.com/i }))

    await go(user, /history/i)
    await user.click(screen.getByRole('button', { name: /^activity$/i }))
    rows = screen.getAllByTestId('activity-row')
    const text = rows.map((r) => r.textContent).join(' | ')
    expect(text).toMatch(/removed.*jane@example\.com/)
  })
})

describe('editing a past sale', () => {
  it('lets a manager change quantities on a completed sale, reflecting in stock and the sale record', async () => {
    const { user } = await renderApp()
    await go(user, /checkout/i)

    // M6 Flat Washer: quantity 64, price 0.05.
    await user.type(screen.getByLabelText(/enter a barcode or sku/i), '5012345678917')
    await user.click(screen.getByRole('button', { name: /add to sale/i }))
    await screen.findByTestId('cart-row')
    await user.click(screen.getByRole('button', { name: 'eBay' }))
    await user.type(screen.getByLabelText(/cash received/i), '1')
    await user.click(screen.getByRole('button', { name: /complete sale/i }))
    await screen.findByTestId('last-sale')

    await go(user, /history/i)
    await user.click(screen.getByRole('button', { name: /^sales$/i }))
    await user.click(screen.getByRole('button', { name: /view receipt/i }))

    const receipt = screen.getByRole('dialog')
    await user.click(within(receipt).getByRole('button', { name: /edit sale/i }))

    const editDialog = screen.getByRole('dialog')
    const qty = within(editDialog).getByLabelText(/quantity for m6 flat washer/i)
    // number inputs don't support setSelectionRange in jsdom, so clear+type
    // can't select-and-replace the existing digit; fire the change directly.
    fireEvent.change(qty, { target: { value: '3' } })
    await user.click(within(editDialog).getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByTestId('sale-row')).toHaveTextContent('0.15')
    expect(screen.getByTestId('sale-row')).toHaveTextContent('Edited')

    await go(user, /products/i)
    const productRow = screen
      .getAllByTestId('product-row')
      .find((r) => r.textContent?.includes('M6 Flat Washer'))
    // 64 in stock originally, -3 after the edit replaces the original -1 sale.
    expect(productRow).toHaveTextContent('61')
  })

  it('refuses to save an edit that oversells the current stock', async () => {
    const { user } = await renderApp()
    await go(user, /checkout/i)

    // Battery Pack 18V 4Ah: quantity 2, price 34.99.
    await user.type(screen.getByLabelText(/enter a barcode or sku/i), '4006381333948')
    await user.click(screen.getByRole('button', { name: /add to sale/i }))
    await screen.findByTestId('cart-row')
    await user.click(screen.getByRole('button', { name: 'eBay' }))
    await user.type(screen.getByLabelText(/cash received/i), '40')
    await user.click(screen.getByRole('button', { name: /complete sale/i }))
    await screen.findByTestId('last-sale')

    await go(user, /history/i)
    await user.click(screen.getByRole('button', { name: /^sales$/i }))
    await user.click(screen.getByRole('button', { name: /view receipt/i }))
    const receipt = screen.getByRole('dialog')
    await user.click(within(receipt).getByRole('button', { name: /edit sale/i }))

    const editDialog = screen.getByRole('dialog')
    const qty = within(editDialog).getByLabelText(/quantity for battery pack/i)
    fireEvent.change(qty, { target: { value: '9' } })
    expect(within(editDialog).getByText(/only 2 in stock/i)).toBeInTheDocument()

    await user.click(within(editDialog).getByRole('button', { name: /save changes/i }))
    expect(await within(editDialog).findByText(/fix the stock issues/i)).toBeInTheDocument()
  })

  it('keeps an in-progress sale edit when switching to another tab and back', async () => {
    const { user } = await renderApp()
    await go(user, /checkout/i)

    // M6 Flat Washer: quantity 64, price 0.05.
    await user.type(screen.getByLabelText(/enter a barcode or sku/i), '5012345678917')
    await user.click(screen.getByRole('button', { name: /add to sale/i }))
    await screen.findByTestId('cart-row')
    await user.click(screen.getByRole('button', { name: 'eBay' }))
    await user.type(screen.getByLabelText(/cash received/i), '1')
    await user.click(screen.getByRole('button', { name: /complete sale/i }))
    await screen.findByTestId('last-sale')

    await go(user, /history/i)
    await user.click(screen.getByRole('button', { name: /^sales$/i }))
    await user.click(screen.getByRole('button', { name: /view receipt/i }))
    const receipt = screen.getByRole('dialog')
    await user.click(within(receipt).getByRole('button', { name: /edit sale/i }))

    const editDialog = screen.getByRole('dialog')
    fireEvent.change(within(editDialog).getByLabelText(/quantity for m6 flat washer/i), {
      target: { value: '3' },
    })

    // The dialog used to live inside History's Sales view, so switching to
    // a totally different tab unmounted it and silently threw away the
    // edit. It's now rendered at the top of the app, alongside the product
    // dialog, specifically so this survives — same as editing a product.
    await go(user, /products/i)
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await go(user, /history/i)
    const stillOpenDialog = screen.getByRole('dialog')
    expect(within(stillOpenDialog).getByLabelText(/quantity for m6 flat washer/i)).toHaveValue(3)

    await user.click(within(stillOpenDialog).getByRole('button', { name: /save changes/i }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    // History remounted when we tabbed back to it, so it's showing Stock
    // movements again rather than Sales — switch back to confirm the save
    // actually landed.
    await user.click(screen.getByRole('button', { name: /^sales$/i }))
    expect(screen.getByTestId('sale-row')).toHaveTextContent('0.15')
    expect(screen.getByTestId('sale-row')).toHaveTextContent('Edited')
  })

  it('picks up an unsaved sale edit if the dialog is reopened before saving', async () => {
    const { user } = await renderApp()
    await go(user, /checkout/i)

    // M6 Flat Washer: quantity 64, price 0.05.
    await user.type(screen.getByLabelText(/enter a barcode or sku/i), '5012345678917')
    await user.click(screen.getByRole('button', { name: /add to sale/i }))
    await screen.findByTestId('cart-row')
    await user.click(screen.getByRole('button', { name: 'eBay' }))
    await user.type(screen.getByLabelText(/cash received/i), '1')
    await user.click(screen.getByRole('button', { name: /complete sale/i }))
    await screen.findByTestId('last-sale')

    await go(user, /history/i)
    await user.click(screen.getByRole('button', { name: /^sales$/i }))
    await user.click(screen.getByRole('button', { name: /view receipt/i }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /edit sale/i }))

    fireEvent.change(within(screen.getByRole('dialog')).getByLabelText(/quantity for m6 flat washer/i), {
      target: { value: '5' },
    })

    // Cancelling without saving stands in for the dialog getting torn down
    // by a real tab/app switch (e.g. a backgrounded PWA reloading) —
    // saleEditDraftStorage.ts deliberately never clears on close, only on a
    // successful save or sign-out, same rule productDraftStorage.ts uses
    // for the product form.
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^cancel$/i }))
    expect(screen.queryByRole('dialog')).toBeNull()

    await user.click(screen.getByRole('button', { name: /view receipt/i }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /edit sale/i }))

    const reopened = screen.getByRole('dialog')
    expect(within(reopened).getByText(/picked up where you left off/i)).toBeInTheDocument()
    expect(within(reopened).getByLabelText(/quantity for m6 flat washer/i)).toHaveValue(5)

    await user.click(within(reopened).getByRole('button', { name: /discard draft/i }))
    expect(within(reopened).getByLabelText(/quantity for m6 flat washer/i)).toHaveValue(1)
  })
})

describe('recalling a sale by scanning its receipt', () => {
  it('pops the matching receipt open on History, regardless of the current tab or date filter', async () => {
    const { user } = await renderApp()
    await go(user, /checkout/i)

    await user.type(screen.getByLabelText(/enter a barcode or sku/i), '5012345678917')
    await user.click(screen.getByRole('button', { name: /add to sale/i }))
    await screen.findByTestId('cart-row')
    await user.click(screen.getByRole('button', { name: 'eBay' }))
    await user.type(screen.getByLabelText(/cash received/i), '1')
    await user.click(screen.getByRole('button', { name: /complete sale/i }))
    await screen.findByTestId('last-sale')

    // The printed receipt's scannable code encodes the sale's own id —
    // read it the same way a wedge scanner reading the printed code would
    // hand it back, rather than reaching into repository internals.
    const scanCode = screen.getByRole('img', { name: /scannable code/i, hidden: true })
    const saleId = scanCode.getAttribute('data-scan-value')
    expect(saleId).toBeTruthy()

    // History defaults to Stock movements, not Sales — scanning should get
    // there on its own rather than requiring a manual toggle first.
    await go(user, /history/i)
    expect(screen.queryByTestId('sale-row')).toBeNull()

    wedgeScan(saleId!)

    const receipt = await screen.findByRole('dialog')
    expect(receipt).toHaveTextContent('eBay')
    expect(receipt).toHaveTextContent('0.05')
  })

  it('tells you when a scanned code matches no sale', async () => {
    const { user } = await renderApp()
    await go(user, /history/i)

    wedgeScan('not-a-real-sale-id')

    expect(await screen.findByRole('status')).toHaveTextContent(/no sale matches "not-a-real-sale-id"/i)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('stocktake', () => {
  it('imports a pasted barcode dump, tallies counts and shows the difference against system stock', async () => {
    const { user } = await renderApp()
    await go(user, /stocktake/i)

    // M6 Flat Washer (5012345678917): system quantity 64, scan 60 -> short 4.
    // Cordless Drill 18V (4006381333931): system quantity 7, scan 9 -> up 2.
    await user.type(
      screen.getByLabelText(/scanned barcodes/i),
      Array(60).fill('5012345678917').join('\n') + '\n' + Array(9).fill('4006381333931').join('\n'),
    )
    await user.click(screen.getByRole('button', { name: /import count/i }))

    const rows = screen.getAllByTestId('stocktake-row')
    expect(rows).toHaveLength(2)
    // Sorted by biggest discrepancy first: washer is off by 4, drill by 2.
    expect(rows[0]).toHaveTextContent('M6 Flat Washer')
    expect(rows[0]).toHaveTextContent('Counted')
    expect(rows[0]).toHaveTextContent('60')
    expect(rows[0]).toHaveTextContent('System')
    expect(rows[0]).toHaveTextContent('64')
    expect(rows[0]).toHaveTextContent('-4')

    expect(rows[1]).toHaveTextContent('Cordless Drill 18V')
    expect(rows[1]).toHaveTextContent('+2')
  })

  it('applies an approved count as a stock adjustment', async () => {
    const { user } = await renderApp()
    await go(user, /stocktake/i)

    await user.type(
      screen.getByLabelText(/scanned barcodes/i),
      Array(60).fill('5012345678917').join('\n'),
    )
    await user.click(screen.getByRole('button', { name: /import count/i }))

    const row = screen.getByTestId('stocktake-row')
    await user.click(within(row).getByRole('button', { name: /approve/i }))

    expect(await within(row).findByText(/applied/i)).toBeInTheDocument()

    await go(user, /products/i)
    const productRow = screen
      .getAllByTestId('product-row')
      .find((r) => r.textContent?.includes('M6 Flat Washer'))
    expect(productRow).toHaveTextContent('60')
  })

  it('flags a line for recount without changing stock', async () => {
    const { user } = await renderApp()
    await go(user, /stocktake/i)

    await user.type(
      screen.getByLabelText(/scanned barcodes/i),
      Array(60).fill('5012345678917').join('\n'),
    )
    await user.click(screen.getByRole('button', { name: /import count/i }))

    const row = screen.getByTestId('stocktake-row')
    await user.click(within(row).getByRole('button', { name: /recount/i }))
    expect(within(row).getByText(/flagged for recount/i)).toBeInTheDocument()

    await go(user, /products/i)
    const productRow = screen
      .getAllByTestId('product-row')
      .find((r) => r.textContent?.includes('M6 Flat Washer'))
    expect(productRow).toHaveTextContent('64')
  })

  it('lists scanned barcodes that match no product, and offers to add one', async () => {
    const { user } = await renderApp()
    await go(user, /stocktake/i)

    await user.type(screen.getByLabelText(/scanned barcodes/i), '0000000000000')
    await user.click(screen.getByRole('button', { name: /import count/i }))

    const row = await screen.findByTestId('unmatched-row')
    expect(row).toHaveTextContent('0000000000000')

    await user.click(within(row).getByRole('button', { name: /add product/i }))
    expect(within(screen.getByRole('dialog')).getByLabelText(/^barcode/i)).toHaveValue(
      '0000000000000',
    )
  })

  it('offers a print report button once a count is imported', async () => {
    const { user } = await renderApp()
    await go(user, /stocktake/i)

    await user.type(screen.getByLabelText(/scanned barcodes/i), '5012345678917')
    await user.click(screen.getByRole('button', { name: /import count/i }))

    expect(screen.getByRole('button', { name: /print report/i })).toBeInTheDocument()
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

    expect(within(screen.getByRole('dialog')).getByLabelText(/^barcode/i)).toHaveValue(
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

describe('checkout', () => {
  it('adds an item, completes a sale, decrements stock and records profit', async () => {
    const { user } = await renderApp()
    await go(user, /checkout/i)

    // M6 Flat Washer: quantity 64, cost 0.01, price 0.05.
    await user.type(screen.getByLabelText(/enter a barcode or sku/i), '5012345678917')
    await user.click(screen.getByRole('button', { name: /add to sale/i }))

    const row = await screen.findByTestId('cart-row')
    expect(row).toHaveTextContent('M6 Flat Washer')
    expect(screen.getByTestId('cart-totals')).toHaveTextContent('Subtotal: £0.05')

    await user.click(screen.getByRole('button', { name: 'eBay' }))
    await user.type(screen.getByLabelText(/cash received/i), '1')
    await user.click(screen.getByRole('button', { name: /complete sale/i }))

    await waitFor(() => expect(screen.queryByTestId('cart-row')).toBeNull())
    expect(await screen.findByTestId('last-sale')).toHaveTextContent('eBay')
    expect(screen.getByTestId('last-sale')).toHaveTextContent(/cash received £1.00.*change £0.95/i)
    expect(screen.getByRole('button', { name: /print receipt/i })).toBeInTheDocument()

    await go(user, /products/i)
    const productRow = screen
      .getAllByTestId('product-row')
      .find((r) => r.textContent?.includes('M6 Flat Washer'))
    expect(productRow).toHaveTextContent('63')

    await go(user, /history/i)
    await user.click(screen.getByRole('button', { name: /^sales$/i }))
    expect(screen.getByTestId('pl-revenue')).toHaveTextContent('0.05')
    expect(screen.getByTestId('pl-profit')).toHaveTextContent('0.04')
    expect(screen.getByTestId('sale-row')).toHaveTextContent('eBay')

    const productBreakdown = screen.getByTestId('product-breakdown-row')
    expect(productBreakdown).toHaveTextContent('M6 Flat Washer')
    expect(productBreakdown).toHaveTextContent('1 sold')
    expect(productBreakdown).toHaveTextContent('revenue £0.05')
    expect(productBreakdown).toHaveTextContent('profit £0.04')
  })

  it('nets marketplace fees out of profit, deducting delivery only when the seller paid it', async () => {
    const { user } = await renderApp()
    await go(user, /checkout/i)

    // M6 Flat Washer: cost 0.01, price 0.05 → cart profit 0.04 before fees.
    await user.type(screen.getByLabelText(/enter a barcode or sku/i), '5012345678917')
    await user.click(screen.getByRole('button', { name: /add to sale/i }))
    await screen.findByTestId('cart-row')

    // Exact match, not a substring regex — the "Who paid the buyer
    // protection fee?" toggle buttons below also have "buyer protection
    // fee" in their accessible name, so a loose match would be ambiguous.
    await user.type(screen.getByLabelText('Buyer protection fee'), '1')
    await user.type(screen.getByLabelText(/^vat$/i), '0.5')
    await user.type(screen.getByLabelText(/advertising cost/i), '0.25')
    await user.type(screen.getByLabelText(/delivery cost/i), '2')
    // Buyer paid for delivery themselves, so it should NOT come off profit —
    // only the buyer protection fee, VAT and advertising cost should.
    await user.click(screen.getByRole('button', { name: /buyer paid for delivery/i }))

    // 0.04 - (1 + 0.5 + 0.25) = -1.71; delivery excluded since the buyer paid it.
    expect(screen.getByTestId('cart-totals')).toHaveTextContent('Est. profit: £-1.71')

    await user.click(screen.getByRole('button', { name: 'eBay' }))
    await user.type(screen.getByLabelText(/cash received/i), '1')
    await user.click(screen.getByRole('button', { name: /complete sale/i }))

    const lastSale = await screen.findByTestId('last-sale')
    expect(lastSale).toHaveTextContent('profit £-1.71')
    const feesLine = screen.getByTestId('last-sale-fees')
    expect(feesLine).toHaveTextContent('Buyer protection £1.00 (Me paid)')
    expect(feesLine).toHaveTextContent('Delivery £2.00 (Buyer paid)')
    expect(feesLine).toHaveTextContent('VAT £0.50')
    expect(feesLine).toHaveTextContent('Advertising £0.25')

    // The marketplace fees reset for the next sale rather than carrying over.
    expect(screen.getByLabelText('Buyer protection fee')).toHaveValue(null)

    // The printed receipt (portalled off-screen, only shown by @media print)
    // carries the same fee breakdown as the on-screen "Last sale" panel —
    // it used to only show the line items and total, leaving VAT and every
    // other fee off the printed copy entirely.
    const printReceipt = screen.getByTestId('print-receipt')
    expect(printReceipt).toHaveTextContent('Buyer protection: £1.00 (Me paid)')
    expect(printReceipt).toHaveTextContent('Delivery: £2.00 (Buyer paid)')
    expect(printReceipt).toHaveTextContent('VAT: £0.50')
    expect(printReceipt).toHaveTextContent('Advertising: £0.25')
    expect(printReceipt).toHaveTextContent('Profit: £-1.71')
    // And a scannable code for finding this exact sale again later.
    expect(within(printReceipt).getByRole('img', { name: /scannable code/i, hidden: true })).toBeInTheDocument()

    // Portalled straight onto <body>, not nested inside .app — this is what
    // lets @media print hide the whole app with `display: none` instead of
    // the old visibility trick that printed several blank pages.
    expect(printReceipt.closest('.app')).toBeNull()
    expect(printReceipt.parentElement).toBe(document.body)
  })

  it('excludes the buyer protection fee from profit when the buyer paid it', async () => {
    const { user } = await renderApp()
    await go(user, /checkout/i)

    // M6 Flat Washer: cost 0.01, price 0.05 → cart profit 0.04 before fees.
    await user.type(screen.getByLabelText(/enter a barcode or sku/i), '5012345678917')
    await user.click(screen.getByRole('button', { name: /add to sale/i }))
    await screen.findByTestId('cart-row')

    await user.type(screen.getByLabelText('Buyer protection fee'), '1')
    await user.click(screen.getByRole('button', { name: /buyer paid the buyer protection fee/i }))

    // The buyer protection fee is excluded since the buyer paid it — profit
    // stays at the plain cart profit of 0.04.
    expect(screen.getByTestId('cart-totals')).toHaveTextContent('Est. profit: £0.04')

    await user.click(screen.getByRole('button', { name: 'eBay' }))
    await user.type(screen.getByLabelText(/cash received/i), '1')
    await user.click(screen.getByRole('button', { name: /complete sale/i }))

    const lastSale = await screen.findByTestId('last-sale')
    expect(lastSale).toHaveTextContent('profit £0.04')
    expect(screen.getByTestId('last-sale-fees')).toHaveTextContent('Buyer protection £1.00 (Buyer paid)')
  })

  it('checks the itemised fees against an entered order total, flagging a mismatch with the exact gap', async () => {
    const { user } = await renderApp()
    await go(user, /checkout/i)

    // M6 Flat Washer: cost 0.01, price 0.05 → subtotal 0.05 for one.
    await user.type(screen.getByLabelText(/enter a barcode or sku/i), '5012345678917')
    await user.click(screen.getByRole('button', { name: /add to sale/i }))
    await screen.findByTestId('cart-row')

    await user.type(screen.getByLabelText('Buyer protection fee'), '1')
    await user.type(screen.getByLabelText(/delivery cost/i), '2')
    await user.click(screen.getByRole('button', { name: /buyer paid for delivery/i }))
    await user.type(screen.getByLabelText(/^vat$/i), '0.5')

    // Itemised: 0.05 + 1 + 2 + 0.5 = 3.55 — enter that as the order total.
    // (Delivery only counts here because the buyer paid it — otherwise it
    // never showed up on the buyer's own order total.)
    await user.type(screen.getByLabelText(/order total/i), '3.55')
    expect(screen.getByTestId('order-total-check')).toHaveTextContent('Matches your order total (£3.55).')

    // Now change it to something that doesn't add up, as if a fee had been
    // forgotten — the gap should be called out exactly.
    await user.clear(screen.getByLabelText(/order total/i))
    await user.type(screen.getByLabelText(/order total/i), '5')
    expect(screen.getByTestId('order-total-check')).toHaveTextContent(
      "You've itemised £3.55, but entered an order total of £5.00 — you're £1.45 short. Check you haven't missed a fee.",
    )
  })

  it('excludes delivery cost from the itemised check when the seller paid it', async () => {
    const { user } = await renderApp()
    await go(user, /checkout/i)

    // M6 Flat Washer: cost 0.01, price 0.05 → subtotal 0.05 for one.
    await user.type(screen.getByLabelText(/enter a barcode or sku/i), '5012345678917')
    await user.click(screen.getByRole('button', { name: /add to sale/i }))
    await screen.findByTestId('cart-row')

    await user.type(screen.getByLabelText('Buyer protection fee'), '1')
    await user.click(screen.getByRole('button', { name: /buyer paid the buyer protection fee/i }))
    await user.type(screen.getByLabelText(/delivery cost/i), '2')
    // Left as the default — seller paid for delivery (e.g. a free-postage
    // listing) — so it never appeared on the buyer's own order total.

    // Itemised for reconciliation purposes: 0.05 + 1 (delivery excluded) =
    // 1.05, which is what the buyer's real order total should equal.
    await user.type(screen.getByLabelText(/order total/i), '1.05')
    expect(screen.getByTestId('order-total-check')).toHaveTextContent('Matches your order total (£1.05).')
  })

  it('flags the item-price-already-includes-a-fee mistake with an actionable message', async () => {
    const { user } = await renderApp()
    await go(user, /checkout/i)

    // M6 Flat Washer, edited to (mistakenly) hold a marketplace's full order
    // total rather than the item's own price — the exact real-world slip
    // this message exists to catch.
    await user.type(screen.getByLabelText(/enter a barcode or sku/i), '5012345678917')
    await user.click(screen.getByRole('button', { name: /add to sale/i }))
    const cartRow = await screen.findByTestId('cart-row')

    const itemPrice = within(cartRow).getByLabelText(/item price for m6 flat washer/i)
    fireEvent.change(itemPrice, { target: { value: '3' } })

    await user.type(screen.getByLabelText('Buyer protection fee'), '1')
    await user.type(screen.getByLabelText(/delivery cost/i), '2')
    await user.click(screen.getByRole('button', { name: /buyer paid for delivery/i }))
    await user.type(screen.getByLabelText(/^vat$/i), '0.5')
    // Itemised: 3 + 1 + 2 + 0.5 = 6.5, but the real order total was only 5 —
    // the fees are already baked into the (too-high) item price above.
    // (Delivery counts here because the buyer paid it.)
    await user.type(screen.getByLabelText(/order total/i), '5')

    expect(screen.getByTestId('order-total-check')).toHaveTextContent(
      "You've itemised £6.50, but entered an order total of £5.00 — that's £1.50 more than the order total. " +
        "Check the item price above isn't already including a fee you've also entered below.",
    )
  })

  it('routes a wedge scan to the cart instead of the scan screen while on checkout', async () => {
    const { user } = await renderApp()
    await go(user, /checkout/i)

    wedgeScan('5012345678917')

    expect(await screen.findByTestId('cart-row')).toHaveTextContent('M6 Flat Washer')
    expect(screen.queryByTestId('scan-match')).toBeNull()
    expect(screen.getByRole('button', { name: /^checkout$/i })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('refuses to check out without choosing a channel', async () => {
    const { user } = await renderApp()
    await go(user, /checkout/i)

    await user.type(screen.getByLabelText(/enter a barcode or sku/i), '5012345678917')
    await user.click(screen.getByRole('button', { name: /add to sale/i }))
    await screen.findByTestId('cart-row')

    await user.click(screen.getByRole('button', { name: /complete sale/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/choose where this was sold/i)
  })

  it('refuses to oversell from the cart', async () => {
    const { user } = await renderApp()
    await go(user, /checkout/i)

    // Battery Pack 18V 4Ah: quantity 2.
    await user.type(screen.getByLabelText(/enter a barcode or sku/i), '4006381333948')
    await user.click(screen.getByRole('button', { name: /add to sale/i }))
    const row = await screen.findByTestId('cart-row')

    await user.clear(within(row).getByLabelText(/quantity for/i))
    await user.type(within(row).getByLabelText(/quantity for/i), '9')

    expect(row).toHaveTextContent(/only 2 in stock/i)

    await user.click(screen.getByRole('button', { name: 'eBay' }))
    await user.click(screen.getByRole('button', { name: /complete sale/i }))
    expect(await screen.findByText(/fix the stock issues/i)).toBeInTheDocument()
  })

  it('shows change due as cash is entered, and flags a short amount', async () => {
    const { user } = await renderApp()
    await go(user, /checkout/i)

    // M6 Flat Washer: price 0.05.
    await user.type(screen.getByLabelText(/enter a barcode or sku/i), '5012345678917')
    await user.click(screen.getByRole('button', { name: /add to sale/i }))
    await screen.findByTestId('cart-row')

    expect(screen.getByTestId('change-due')).toHaveTextContent('—')

    await user.type(screen.getByLabelText(/cash received/i), '0.02')
    expect(screen.getByTestId('change-due')).toHaveTextContent(/short £0.03/i)

    await user.click(screen.getByRole('button', { name: 'eBay' }))
    await user.click(screen.getByRole('button', { name: /complete sale/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/less than the total/i)

    await user.clear(screen.getByLabelText(/cash received/i))
    await user.type(screen.getByLabelText(/cash received/i), '1')
    expect(screen.getByTestId('change-due')).toHaveTextContent('0.95')
  })

  it('requires cash received before completing a cash sale', async () => {
    const { user } = await renderApp()
    await go(user, /checkout/i)

    await user.type(screen.getByLabelText(/enter a barcode or sku/i), '5012345678917')
    await user.click(screen.getByRole('button', { name: /add to sale/i }))
    await screen.findByTestId('cart-row')
    await user.click(screen.getByRole('button', { name: 'eBay' }))

    await user.click(screen.getByRole('button', { name: /complete sale/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/enter the cash received/i)
  })

  it('adds a custom sale channel from the checkout screen and offers it on the Settings screen', async () => {
    const { user } = await renderApp()
    await go(user, /checkout/i)

    await user.type(screen.getByLabelText(/add a new channel/i), 'Car Boot Sale')
    await user.click(screen.getByRole('button', { name: /add channel/i }))

    expect(await screen.findByRole('button', { name: 'Car Boot Sale' })).toBeInTheDocument()

    await go(user, /settings/i)
    await user.click(screen.getByRole('button', { name: /^catalogue$/i }))
    expect(screen.getByDisplayValue('Car Boot Sale')).toBeInTheDocument()
  })
})

describe('login email', () => {
  it('lets a manager request a login email change and shows the confirmation-link prompt', async () => {
    const base = createLocalRepository({ storage: memoryStorage(), seed: true })
    const updateLoginEmail = vi.fn(async () => ({ ok: true as const, value: true as const }))
    const repository: InventoryRepository = {
      ...base,
      kind: 'supabase',
      async getLoginEmail() {
        return 'mason@example.com'
      },
      updateLoginEmail,
    }
    const { user } = await renderApp(repository)

    await go(user, /settings/i)
    await screen.findByText('mason@example.com')

    await user.type(screen.getByLabelText(/new login email/i), 'newmason@example.com')
    await user.click(screen.getByRole('button', { name: /send confirmation/i }))

    expect(updateLoginEmail).toHaveBeenCalledWith('newmason@example.com')
    expect(await screen.findByText(/check newmason@example\.com/i)).toBeInTheDocument()
  })

  it('does not offer a login email change in local (offline demo) mode', async () => {
    const { user } = await renderApp()
    await go(user, /settings/i)
    await screen.findByRole('heading', { name: /^account settings$/i })

    expect(screen.queryByLabelText(/new login email/i)).not.toBeInTheDocument()
  })
})

describe('returns', () => {
  it('records a refunded return, restocks the item and shows it in the case list', async () => {
    const { user } = await renderApp()
    await go(user, /returns/i)

    await user.type(screen.getByLabelText(/search products to return/i), 'washer')
    await user.click(screen.getByRole('button', { name: /^add$/i }))

    const row = await screen.findByTestId('return-cart-row')
    expect(row).toHaveTextContent('M6 Flat Washer')

    await user.click(screen.getByRole('button', { name: 'Refund' }))
    await user.type(screen.getByLabelText(/refund amount/i), '2.50')
    await user.type(screen.getByLabelText(/^channel$/i), 'eBay')
    await user.type(screen.getByLabelText(/^reason$/i), 'Wrong size')

    await user.click(screen.getByRole('button', { name: /save case/i }))

    expect(await screen.findByTestId('last-return')).toHaveTextContent('Refund')
    expect(screen.getByTestId('last-return')).toHaveTextContent('2.50')

    await go(user, /products/i)
    const productRow = screen
      .getAllByTestId('product-row')
      .find((r) => r.textContent?.includes('M6 Flat Washer'))
    // 64 in stock, +1 restocked from the default return quantity.
    expect(productRow).toHaveTextContent('65')

    await go(user, /returns/i)
    expect(screen.getByTestId('returns-case-count')).toHaveTextContent('1')
    expect(screen.getByTestId('returns-refund-total')).toHaveTextContent('2.50')
    expect(screen.getByTestId('return-case-row')).toHaveTextContent('eBay')
  })

  it('writes off a returned item with no stock change and tracks the loss', async () => {
    const { user } = await renderApp()
    await go(user, /returns/i)

    await user.type(screen.getByLabelText(/search products to return/i), 'washer')
    await user.click(screen.getByRole('button', { name: /^add$/i }))

    const row = await screen.findByTestId('return-cart-row')
    await user.click(within(row).getByRole('button', { name: /written off/i }))

    await user.click(screen.getByRole('button', { name: 'Return' }))
    await user.click(screen.getByRole('button', { name: /save case/i }))

    await waitFor(() => expect(screen.queryByTestId('return-cart-row')).toBeNull())

    await go(user, /products/i)
    const productRow = screen
      .getAllByTestId('product-row')
      .find((r) => r.textContent?.includes('M6 Flat Washer'))
    expect(productRow).toHaveTextContent('64')

    await go(user, /returns/i)
    // Cost 0.01 per unit written off.
    expect(screen.getByTestId('returns-writeoff-loss')).toHaveTextContent('0.01')
  })

  it('sends out a replacement at no charge, decrementing stock', async () => {
    const { user } = await renderApp()
    await go(user, /returns/i)

    await user.type(screen.getByLabelText(/search products to send out/i), 'washer')
    await user.click(screen.getByRole('button', { name: /^add$/i }))

    expect(await screen.findByTestId('replacement-cart-row')).toHaveTextContent('M6 Flat Washer')

    await user.click(screen.getByRole('button', { name: 'Replacement' }))
    await user.click(screen.getByRole('button', { name: /save case/i }))

    await waitFor(() => expect(screen.queryByTestId('replacement-cart-row')).toBeNull())

    await go(user, /products/i)
    const productRow = screen
      .getAllByTestId('product-row')
      .find((r) => r.textContent?.includes('M6 Flat Washer'))
    expect(productRow).toHaveTextContent('63')
  })

  it('accepts a goodwill-only case with no item or sale involved', async () => {
    const { user } = await renderApp()
    await go(user, /returns/i)

    await user.click(screen.getByRole('button', { name: /goodwill gesture/i }))
    await user.type(screen.getByLabelText(/goodwill type/i), 'Voucher')
    await user.type(screen.getByLabelText(/goodwill value/i), '10')
    await user.click(screen.getByRole('button', { name: /save case/i }))

    expect(await screen.findByTestId('last-return')).toHaveTextContent('Goodwill gesture')
    expect(screen.getByTestId('returns-goodwill-total')).toHaveTextContent('10.00')
  })

  it('rejects an empty case with nothing recorded', async () => {
    const { user } = await renderApp()
    await go(user, /returns/i)

    await user.click(screen.getByRole('button', { name: /save case/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/at least one action/i)
  })

  it('links a case to an existing till sale', async () => {
    const { user } = await renderApp()
    await go(user, /checkout/i)

    await user.type(screen.getByLabelText(/enter a barcode or sku/i), '5012345678917')
    await user.click(screen.getByRole('button', { name: /add to sale/i }))
    await screen.findByTestId('cart-row')
    await user.click(screen.getByRole('button', { name: 'eBay' }))
    await user.type(screen.getByLabelText(/cash received/i), '1')
    await user.click(screen.getByRole('button', { name: /complete sale/i }))
    await screen.findByTestId('last-sale')

    await go(user, /returns/i)
    const saleSelect = screen.getByLabelText(/original sale/i)
    const saleOption = within(saleSelect).getAllByRole('option')[1]
    await user.selectOptions(saleSelect, saleOption)
    // Linking a sale auto-fills the channel from it.
    expect(screen.getByLabelText(/^channel$/i)).toHaveValue('eBay')

    await user.click(screen.getByRole('button', { name: /goodwill gesture/i }))
    await user.type(screen.getByLabelText(/goodwill type/i), 'Sorry card')
    await user.click(screen.getByRole('button', { name: /save case/i }))

    expect(await screen.findByTestId('last-return')).toBeInTheDocument()
  })

  it('drills into a past case and lets a manager edit it', async () => {
    const { user } = await renderApp()
    await go(user, /returns/i)

    await user.type(screen.getByLabelText(/search products to return/i), 'washer')
    await user.click(screen.getByRole('button', { name: /^add$/i }))
    await screen.findByTestId('return-cart-row')

    await user.click(screen.getByRole('button', { name: 'Refund' }))
    await user.type(screen.getByLabelText(/refund amount/i), '2.50')
    await user.type(screen.getByLabelText(/^channel$/i), 'eBay')
    await user.click(screen.getByRole('button', { name: /save case/i }))
    await screen.findByTestId('last-return')

    const row = screen.getByTestId('return-case-row')
    await user.click(within(row).getByRole('button', { name: /view details/i }))

    const detail = screen.getByRole('dialog')
    expect(detail).toHaveTextContent('Refund')
    expect(detail).toHaveTextContent('2.50')

    await user.click(within(detail).getByRole('button', { name: /edit case/i }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    expect(screen.getByTestId('return-edit-banner')).toBeInTheDocument()
    const refundInput = screen.getByLabelText(/refund amount/i)
    await user.clear(refundInput)
    await user.type(refundInput, '5.00')
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(screen.queryByTestId('return-edit-banner')).toBeNull())
    expect(screen.getByTestId('returns-refund-total')).toHaveTextContent('5.00')
    expect(screen.getByTestId('return-case-row')).toHaveTextContent('Edited')
  })
})

describe('suppliers and purchase orders', () => {
  it('adds a supplier, drafts a PO, walks it through to received, and adds the ordered stock', async () => {
    const { user } = await renderApp()
    await go(user, /suppliers/i)

    // Add a supplier.
    await user.click(screen.getByRole('button', { name: /add a supplier/i }))
    await user.type(screen.getByLabelText(/supplier name/i), 'Acme Fasteners Ltd')
    await user.type(screen.getByLabelText(/usual lead time/i), '5')
    await user.click(screen.getByRole('button', { name: /^add supplier$/i }))

    // Saving asks for confirmation first, same as the product form.
    expect(await screen.findByText(/add "acme fasteners ltd" as a new supplier/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /yes, save/i }))

    const supplierList = await screen.findByTestId('supplier-list')
    expect(supplierList).toHaveTextContent('Acme Fasteners Ltd')

    // Create a draft PO ordering 20 more M6 Flat Washers (currently 64 in stock).
    await user.click(screen.getByRole('button', { name: /new purchase order/i }))
    await user.selectOptions(screen.getByLabelText(/^supplier$/i), 'Acme Fasteners Ltd')
    await user.selectOptions(screen.getByLabelText('Product'), 'M6 Flat Washer (WSH-M6)')
    await user.clear(screen.getByLabelText('Quantity'))
    await user.type(screen.getByLabelText('Quantity'), '20')
    await user.clear(screen.getByLabelText('Unit cost'))
    await user.type(screen.getByLabelText('Unit cost'), '0.01')
    await user.click(screen.getByRole('button', { name: /create draft po/i }))

    // Same confirmation step for the PO.
    expect(await screen.findByText(/create this purchase order for acme fasteners ltd/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /yes, create/i }))

    const poList = await screen.findByTestId('purchase-order-list')
    expect(poList).toHaveTextContent('Acme Fasteners Ltd')
    expect(poList).toHaveTextContent('Draft')
    expect(poList).toHaveTextContent('0.20') // 20 * 0.01

    // Walk it through the status flow.
    await user.click(within(poList).getByRole('button', { name: /^send$/i }))
    await waitFor(() => expect(within(screen.getByTestId('purchase-order-list')).getByText('Sent')).toBeInTheDocument())

    await user.click(within(screen.getByTestId('purchase-order-list')).getByRole('button', { name: /^confirm$/i }))
    await waitFor(() =>
      expect(within(screen.getByTestId('purchase-order-list')).getByText('Confirmed')).toBeInTheDocument(),
    )

    await user.click(
      within(screen.getByTestId('purchase-order-list')).getByRole('button', { name: /mark received/i }),
    )
    await waitFor(() =>
      expect(within(screen.getByTestId('purchase-order-list')).getByText('Received')).toBeInTheDocument(),
    )

    // Stock actually went up by the ordered quantity: 64 + 20 = 84.
    await go(user, /products/i)
    const productRow = screen.getAllByTestId('product-row').find((r) => r.textContent?.includes('M6 Flat Washer'))
    expect(productRow).toHaveTextContent('84')

    // And it shows up as an ordinary stock-in movement in History.
    await go(user, /history/i)
    expect(screen.getByText(/PO received from Acme Fasteners Ltd/i)).toBeInTheDocument()
  })

  it('deleting a supplier removes it from the list', async () => {
    const { user } = await renderApp()
    await go(user, /suppliers/i)

    await user.click(screen.getByRole('button', { name: /add a supplier/i }))
    await user.type(screen.getByLabelText(/supplier name/i), 'Temp Supplier')
    await user.click(screen.getByRole('button', { name: /^add supplier$/i }))
    await user.click(await screen.findByRole('button', { name: /yes, save/i }))
    await screen.findByText('Temp Supplier')

    await user.click(screen.getByRole('button', { name: /delete temp supplier/i }))
    await waitFor(() => expect(screen.queryByText('Temp Supplier')).not.toBeInTheDocument())
    expect(screen.getByText(/no suppliers yet/i)).toBeInTheDocument()
  })

  it('remembers an in-progress supplier draft if the dialog is closed without saving', async () => {
    const { user } = await renderApp()
    await go(user, /suppliers/i)

    await user.click(screen.getByRole('button', { name: /add a supplier/i }))
    await user.type(screen.getByLabelText(/supplier name/i), 'Draft Supplier Co')

    // Cancelling without saving stands in for the dialog getting torn down
    // by a real tab/app switch (e.g. a backgrounded PWA reloading) —
    // supplierDraftStorage.ts deliberately never clears on close, only on a
    // successful save or sign-out, same rule productDraftStorage.ts and
    // saleEditDraftStorage.ts use.
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^cancel$/i }))
    expect(screen.queryByRole('dialog')).toBeNull()

    await user.click(screen.getByRole('button', { name: /add a supplier/i }))
    const reopened = screen.getByRole('dialog')
    expect(within(reopened).getByText(/picked up where you left off/i)).toBeInTheDocument()
    expect(within(reopened).getByLabelText(/supplier name/i)).toHaveValue('Draft Supplier Co')

    await user.click(within(reopened).getByRole('button', { name: /discard draft/i }))
    expect(within(reopened).getByLabelText(/supplier name/i)).toHaveValue('')
  })

  it('remembers an in-progress purchase order draft if the dialog is closed without saving', async () => {
    const { user } = await renderApp()
    await go(user, /suppliers/i)

    await user.click(screen.getByRole('button', { name: /add a supplier/i }))
    await user.type(screen.getByLabelText(/supplier name/i), 'Acme Fasteners Ltd')
    await user.click(screen.getByRole('button', { name: /^add supplier$/i }))
    await user.click(await screen.findByRole('button', { name: /yes, save/i }))
    await screen.findByTestId('supplier-list')

    await user.click(screen.getByRole('button', { name: /new purchase order/i }))
    await user.selectOptions(screen.getByLabelText(/^supplier$/i), 'Acme Fasteners Ltd')
    await user.type(screen.getByLabelText(/notes \(optional\)/i), 'Ring before delivery')

    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^cancel$/i }))
    expect(screen.queryByRole('dialog')).toBeNull()

    await user.click(screen.getByRole('button', { name: /new purchase order/i }))
    const reopened = screen.getByRole('dialog')
    expect(within(reopened).getByText(/picked up where you left off/i)).toBeInTheDocument()
    expect(within(reopened).getByLabelText(/notes \(optional\)/i)).toHaveValue('Ring before delivery')

    await user.click(within(reopened).getByRole('button', { name: /discard draft/i }))
    expect(within(reopened).getByLabelText(/notes \(optional\)/i)).toHaveValue('')
  })

  it('hides the Suppliers tab from an employee', async () => {
    const base = createLocalRepository({ storage: memoryStorage(), seed: true })
    const repository = { ...base, role: 'employee' as const }
    render(
      <App
        openRepository={async () => repository}
        settingsStorage={memoryStorage()}
        productDraftStorage={memoryStorage()}
        saleEditDraftStorage={memoryStorage()}
        supplierDraftStorage={memoryStorage()}
        purchaseOrderDraftStorage={memoryStorage()}
      />,
    )
    await screen.findByTestId('stat-products')

    expect(within(screen.getByRole('navigation')).queryByRole('button', { name: /suppliers/i })).not.toBeInTheDocument()
  })
})
