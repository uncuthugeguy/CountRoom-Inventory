import { useEffect, useRef } from 'react'
import type { Inventory } from './useInventory'
import type { SettingsApi } from './useSettings'

/**
 * Keeps the label logo, label template, saved label presets, sale channels
 * and product categories in sync with the account in Supabase mode, so
 * they're the same on every device/browser signed into the same account
 * rather than stuck on whichever one happened to set them up. Local
 * (offline demo) mode does nothing here — there's no account to sync to,
 * settings just live in that device's storage, same as always.
 *
 * Two directions:
 *  - On first load with a Supabase backend, pull whatever's already saved
 *    to the account and apply it over this device's local copy (remote
 *    wins — the account is the source of truth once one exists).
 *  - After that, whenever anything local changes (editing it right here),
 *    push the result up so everyone else picks it up next time they open
 *    the app.
 *
 * The pull itself changes local settings (via `applyRemote`), which would
 * otherwise immediately trigger the push effect below and echo the exact
 * thing just pulled straight back up. Rather than try to compare the pushed
 * payload against the pulled one byte-for-byte (fragile — the two are built
 * differently, e.g. the pull's remote payload can omit a field the push
 * always includes), `justPulledRef` just skips the one push-effect run that
 * immediately follows a real pull.
 */
export function useSettingsSync(inventory: Inventory, settings: SettingsApi): void {
  // Starts (and stays) false until the pull below has actually resolved —
  // not just started — so the push effect below can't fire on the very
  // first render with whatever default/local settings happened to be
  // showing before the real account settings arrived.
  const pullStartedRef = useRef(false)
  const pullResolvedRef = useRef(false)
  const justPulledRef = useRef(false)

  useEffect(() => {
    if (inventory.backend !== 'supabase' || pullStartedRef.current) return
    pullStartedRef.current = true
    void (async () => {
      const remote = await inventory.getAccountSettings()
      if (remote) {
        justPulledRef.current = true
        settings.applyRemote(remote)
      }
      pullResolvedRef.current = true
    })()
  }, [inventory, settings])

  useEffect(() => {
    if (inventory.backend !== 'supabase' || !pullResolvedRef.current) return
    if (justPulledRef.current) {
      justPulledRef.current = false
      return
    }
    const current: {
      logoDataUrl?: string
      labelTemplate?: SettingsApi['labelTemplate']
      saleChannels: string[]
      labelPresets: SettingsApi['labelPresets']
      quickCodes: SettingsApi['quickCodes']
      productCategories: string[]
    } = {
      ...(settings.logoDataUrl !== undefined ? { logoDataUrl: settings.logoDataUrl } : {}),
      ...(settings.labelTemplate !== undefined ? { labelTemplate: settings.labelTemplate } : {}),
      saleChannels: settings.saleChannels,
      labelPresets: settings.labelPresets,
      quickCodes: settings.quickCodes,
      productCategories: settings.productCategories,
    }
    void inventory.setAccountSettings(current)
    // Deliberately excludes `inventory` from deps beyond what's used above —
    // it's a fresh object every render, and the fields actually read here
    // are the primitives/objects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    inventory.backend,
    settings.logoDataUrl,
    settings.labelTemplate,
    settings.saleChannels,
    settings.labelPresets,
    settings.quickCodes,
    settings.productCategories,
  ])
}
