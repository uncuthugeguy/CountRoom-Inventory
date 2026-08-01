import { useId, useState, type FormEvent } from 'react'
import { findByBarcode, isLowStock } from '../../domain/inventory'
import type { MovementType, Product } from '../../domain/types'
import { CameraScanner } from '../components/CameraScanner'
import { StockActions } from '../components/StockActions'
import type { StartCameraScan } from '../../scanner/cameraScanner'
import { formatNumber } from '../format'

export interface ScanScreenProps {
  products: Product[]
  /** The most recent barcode from the camera, a wedge scanner or manual entry. */
  lastScan: string | null
  onScan: (barcode: string) => void
  onMove: (product: Product, type: MovementType) => void
  onCreate: (barcode: string) => void
  /** Injected in tests; the component otherwise uses the real camera. */
  startCamera?: StartCameraScan
}

export function ScanScreen({
  products,
  lastScan,
  onScan,
  onMove,
  onCreate,
  startCamera,
}: ScanScreenProps) {
  const manualId = useId()
  const [manual, setManual] = useState('')

  const match = lastScan ? findByBarcode(products, lastScan) : undefined

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const barcode = manual.trim()
    if (!barcode) return
    onScan(barcode)
    setManual('')
  }

  return (
    <div className="screen">
      <section className="panel">
        <h2>Scan a barcode</h2>
        <p className="muted">
          A USB or Bluetooth scanner in keyboard-wedge mode works anywhere in the app — just
          scan. Use the camera when you do not have one to hand.
        </p>
        <CameraScanner onDecode={onScan} start={startCamera} />
      </section>

      <section className="panel">
        <form className="toolbar" onSubmit={submit}>
          <div className="field field-grow">
            <label htmlFor={manualId}>Enter a barcode</label>
            <input
              id={manualId}
              value={manual}
              inputMode="numeric"
              autoComplete="off"
              placeholder="5012345678900"
              onChange={(event) => setManual(event.target.value)}
            />
          </div>
          <div className="toolbar-actions">
            <button type="submit" className="button button-primary">
              Look up
            </button>
          </div>
        </form>
      </section>

      {lastScan && (
        <section className="panel">
          <header className="panel-header">
            <h2>Last scan</h2>
            <span className="mono">{lastScan}</span>
          </header>

          {match ? (
            <div className="scan-match" data-testid="scan-match">
              <h3 className="product-name">{match.name}</h3>
              <p className="product-meta">
                <span className="mono">{match.sku}</span>
                {match.category && <span className="chip">{match.category}</span>}
                {match.location && <span className="chip">{match.location}</span>}
              </p>
              <p className="scan-quantity">
                <span className={`quantity ${isLowStock(match) ? 'quantity-low' : ''}`}>
                  {formatNumber(match.quantity)}
                </span>
                <span className="quantity-caption">on hand</span>
              </p>
              <StockActions product={match} onMove={onMove} />
            </div>
          ) : (
            <div className="scan-miss">
              <p>No product matches that barcode yet.</p>
              <button
                type="button"
                className="button button-primary"
                onClick={() => onCreate(lastScan)}
              >
                Add this product
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
