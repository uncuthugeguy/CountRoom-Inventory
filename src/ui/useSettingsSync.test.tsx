import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createLocalRepository } from '../data/localRepository'
import type { AccountSettingsSync, InventoryRepository } from '../data/repository'
import type { Result } from '../domain/types'
import { memoryStorage } from '../test/memoryStorage'
import { useInventory } from './useInventory'
import { useSettings } from './useSettings'
import { useSettingsSync } from './useSettingsSync'

const okTrue = async (_patch?: AccountSettingsSync): Promise<Result<true>> => ({ ok: true, value: true })

function fakeSupabaseRepo(overrides: Partial<InventoryRepository> = {}): InventoryRepository {
  return {
    kind: 'supabase',
    role: 'manager',
    listProducts: async () => [],
    listMovements: async () => [],
    createProduct: vi.fn(),
    updateProduct: vi.fn(),
    deleteProduct: vi.fn(),
    recordMovement: vi.fn(),
    listSales: async () => [],
    recordSale: vi.fn(),
    updateSale: vi.fn(),
    listReturns: async () => [],
    recordReturn: vi.fn(),
    updateReturn: vi.fn(),
    listTeam: async () => [],
    inviteEmployee: vi.fn(),
    removeTeamMember: vi.fn(),
    getProfile: async () => ({
      fullName: '',
      birthday: '',
      address: '',
      employeeNumber: '',
      username: '',
      updatedAt: 't',
    }),
    updateProfile: vi.fn(),
    listPendingProfileChanges: async () => [],
    approveProfileChange: vi.fn(),
    rejectProfileChange: vi.fn(),
    getAccountSettings: async () => null,
    setAccountSettings: vi.fn(okTrue),
    ...overrides,
  }
}

const setup = (repo: InventoryRepository) =>
  renderHook(() => {
    const inventory = useInventory(async () => repo)
    const settings = useSettings(memoryStorage())
    useSettingsSync(inventory, settings)
    return { inventory, settings }
  })

describe('useSettingsSync', () => {
  it('pulls the account settings once the Supabase backend is ready and applies them locally', async () => {
    const remote: AccountSettingsSync = { logoDataUrl: 'data:remote', saleChannels: ['Remote channel'] }
    const { result } = setup(fakeSupabaseRepo({ getAccountSettings: async () => remote }))

    await waitFor(() => expect(result.current.settings.logoDataUrl).toBe('data:remote'))
    expect(result.current.settings.saleChannels).toEqual(['Remote channel'])
  })

  it('pushes a local settings change up to the account', async () => {
    const setAccountSettings = vi.fn(okTrue)
    const { result } = setup(fakeSupabaseRepo({ setAccountSettings }))

    await waitFor(() => expect(result.current.inventory.status).toBe('ready'))
    act(() => {
      result.current.settings.setLogo('data:local')
    })

    await waitFor(() => expect(setAccountSettings).toHaveBeenCalled())
    const lastPatch = setAccountSettings.mock.calls.at(-1)![0] as AccountSettingsSync
    expect(lastPatch.logoDataUrl).toBe('data:local')
  })

  it('does not push straight back what it just pulled', async () => {
    const remote: AccountSettingsSync = { logoDataUrl: 'data:remote', saleChannels: [] }
    const setAccountSettings = vi.fn(okTrue)
    setup(fakeSupabaseRepo({ getAccountSettings: async () => remote, setAccountSettings }))

    // Give the pull, the resulting re-render, and the push effect a moment
    // to settle — if the sync were naively bidirectional this is exactly
    // where an echoed push back up would happen.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(setAccountSettings).not.toHaveBeenCalled()
  })

  it('does nothing in local mode', async () => {
    const localRepo = createLocalRepository({ storage: memoryStorage() })
    const { result } = setup(localRepo)

    await waitFor(() => expect(result.current.inventory.status).toBe('ready'))
    act(() => {
      result.current.settings.setLogo('data:local-only')
    })

    // Nothing to spy on locally (createLocalRepository's setAccountSettings
    // always errors) — this just documents that using settings normally in
    // local mode doesn't throw or get blocked by the sync hook.
    expect(result.current.settings.logoDataUrl).toBe('data:local-only')
    expect(result.current.inventory.backend).toBe('local')
  })
})
