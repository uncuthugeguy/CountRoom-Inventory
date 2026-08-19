import { useMemo, useState } from 'react'
import { createSettingsStore } from '../data/settingsStorage'
import type { Settings } from '../data/settingsStorage'
import type { QuickCode, QuickCodeDraft } from '../domain/quickCodes'
import type { LabelPreset, LabelTemplate, PrinterKind } from '../printing/labelTemplate'

export interface SettingsApi extends Settings {
  setLogo(dataUrl: string): void
  clearLogo(): void
  addChannel(name: string): void
  renameChannel(oldName: string, newName: string): void
  removeChannel(name: string): void
  setPrinterKind(kind: PrinterKind): void
  setLabelTemplate(template: LabelTemplate): void
  resetLabelTemplate(): void
  setPolonoLabelTemplate(template: LabelTemplate): void
  resetPolonoLabelTemplate(): void
  saveLabelPreset(name: string, template: LabelTemplate): void
  applyLabelPreset(id: string): void
  renameLabelPreset(id: string, newName: string): void
  deleteLabelPreset(id: string): void
  addQuickCode(draft: QuickCodeDraft): string
  updateQuickCode(id: string, patch: Partial<QuickCodeDraft>): void
  deleteQuickCode(id: string): void
  addProductCategory(name: string): void
  renameProductCategory(oldName: string, newName: string): void
  removeProductCategory(name: string): void
  applyRemote(remote: {
    logoDataUrl?: string
    labelTemplate?: LabelTemplate
    saleChannels?: string[]
    labelPresets?: LabelPreset[]
    quickCodes?: QuickCode[]
    productCategories?: string[]
  }): void
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
    setPrinterKind: (kind: PrinterKind) => {
      store.setPrinterKind(kind)
      setSettings(store.get())
    },
    setLabelTemplate: (template: LabelTemplate) => {
      store.setLabelTemplate(template)
      setSettings(store.get())
    },
    resetLabelTemplate: () => {
      store.resetLabelTemplate()
      setSettings(store.get())
    },
    setPolonoLabelTemplate: (template: LabelTemplate) => {
      store.setPolonoLabelTemplate(template)
      setSettings(store.get())
    },
    resetPolonoLabelTemplate: () => {
      store.resetPolonoLabelTemplate()
      setSettings(store.get())
    },
    saveLabelPreset: (name: string, template: LabelTemplate) => {
      store.saveLabelPreset(name, template)
      setSettings(store.get())
    },
    applyLabelPreset: (id: string) => {
      store.applyLabelPreset(id)
      setSettings(store.get())
    },
    renameLabelPreset: (id: string, newName: string) => {
      store.renameLabelPreset(id, newName)
      setSettings(store.get())
    },
    deleteLabelPreset: (id: string) => {
      store.deleteLabelPreset(id)
      setSettings(store.get())
    },
    addQuickCode: (draft: QuickCodeDraft) => {
      const id = store.addQuickCode(draft)
      setSettings(store.get())
      return id
    },
    updateQuickCode: (id: string, patch: Partial<QuickCodeDraft>) => {
      store.updateQuickCode(id, patch)
      setSettings(store.get())
    },
    deleteQuickCode: (id: string) => {
      store.deleteQuickCode(id)
      setSettings(store.get())
    },
    addProductCategory: (name: string) => {
      store.addProductCategory(name)
      setSettings(store.get())
    },
    renameProductCategory: (oldName: string, newName: string) => {
      store.renameProductCategory(oldName, newName)
      setSettings(store.get())
    },
    removeProductCategory: (name: string) => {
      store.removeProductCategory(name)
      setSettings(store.get())
    },
    applyRemote: (remote) => {
      store.applyRemote(remote)
      setSettings(store.get())
    },
  }
}
