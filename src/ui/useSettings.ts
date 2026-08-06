import { useMemo, useState } from 'react'
import { createSettingsStore } from '../data/settingsStorage'
import type { Settings } from '../data/settingsStorage'

export interface SettingsApi extends Settings {
  setLogo(dataUrl: string): void
  clearLogo(): void
  addChannel(name: string): void
  renameChannel(oldName: string, newName: string): void
  removeChannel(name: string): void
}

/** Overridden in tests so the suite never touches the host's real localStorage. */
export function useSettings(storage?: Storage): SettingsApi {
  const store = useMemo(() => createSettingsStore(storage), [storage])
  const [settings, setSettings] = useState<Settings>(() => store.get())

  return {
    ...settings,
    setLogo: (dataUrl: string) => {
      store.setLogo(dataUrl)
      setSettings(store.get())
    },
    clearLogo: () => {
      store.clearLogo()
      setSettings(store.get())
    },
    addChannel: (name: string) => {
      store.addChannel(name)
      setSettings(store.get())
    },
    renameChannel: (oldName: string, newName: string) => {
      store.renameChannel(oldName, newName)
      setSettings(store.get())
    },
    removeChannel: (name: string) => {
      store.removeChannel(name)
      setSettings(store.get())
    },
  }
}
