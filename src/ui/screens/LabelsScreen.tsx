import { useState } from 'react'
import type { Product } from '../../domain/types'
import { BarcodeLabelDesigner } from '../labels/BarcodeLabelDesigner'
import { PrinterSetupPanel } from '../labels/PrinterSetupPanel'
import { ShippingLabelPanel } from '../labels/ShippingLabelPanel'
import type { SettingsApi } from '../useSettings'

type LabelsTab = 'shipping' | 'barcode' | 'printer'

const TABS: { key: LabelsTab; label: string }[] = [
  { key: 'shipping', label: 'Shipping 4 × 6' },
  { key: 'barcode', label: 'Barcode 2 × 1' },
  { key: 'printer', label: 'Printer setup' },
]

export interface LabelsScreenProps {
  settings: SettingsApi
  products: Product[]
}

/** Everything label-related for the Polono: shipping labels, the barcode label layout, printer setup. */
export function LabelsScreen({ settings, products }: LabelsScreenProps) {
  const [tab, setTab] = useState<LabelsTab>('shipping')
  return (
    <div className="screen">
      <div className="channel-picker" aria-label="Label sections">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`button chip-button ${tab === t.key ? 'chip-button-active' : ''}`}
            aria-pressed={tab === t.key}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'shipping' && <ShippingLabelPanel settings={settings} />}
      {tab === 'barcode' && <BarcodeLabelDesigner settings={settings} products={products} />}
      {tab === 'printer' && <PrinterSetupPanel settings={settings} />}
    </div>
  )
}
