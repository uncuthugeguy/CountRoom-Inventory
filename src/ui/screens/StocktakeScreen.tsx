import { useId, useState, type FormEvent } from 'react'
import type { AppliedMovement } from '../../domain/movements'
import { buildStocktakeLines, parseBarcodeDump, type StocktakeLine } from '../../domain/stocktake'
import type { Product, Result } from '../../domain/types'
import { formatDateTime, formatNumber } from '../format'

export interface StocktakeScreenProps {
  products: Product[]
  /** Writes the counted quantity as an absolute stocktake adjustment. */
  onApprove: (product: Product, counted: number) => Promise<Result<AppliedMovement>>
  /** Opens the new-product dialog pre-filled with a scanned code that matched nothing. */
  onCreateProduct: (barcode: string) => void
}

type LineStatus = 'pending' | 'applied' | 'recount'

function differenceClass(difference: number): string {
  if (difference > 0) return 'badge-in'
  if (difference < 0) return 'badge-out'
  return ''
}

function differenceLabel(difference: number): string {
  if (difference > 0) return `+${difference}`
  if (difference < 0) return String(difference)
  return 'Matches'
}

export function StocktakeScreen({ products, onApprove, onCreateProduct }: StocktakeScreenProps) {
  const dumpId = useId()

  const [dump, setDump] = useState('')
  const [session, setSession] = useState<{
    lines: StocktakeLine[]
    unmatched: { barcode: string; counted: number }[]
    importedAt: string
  } | null>(null)
  const [statuses, setStatuses] = useState<Record<string, LineStatus>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const importDump = (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    const counts = parseBarcodeDump(dump)
    if (counts.size === 0) {
      setError('Paste or scan in some barcodes first.')
      return
    }
    const { lines, unmatched } = buildStocktakeLines(counts, products)
    setSession({ lines, unmatched, importedAt: new Date().toISOString() })
    setStatuses({})
    setDump('')
  }

  const startNewCount = () => {
    setSession(null)
    setStatuses({})
    setDump('')
    setError(null)
  }

  const approve = async (line: StocktakeLine) => {
    setSaving(line.barcode)
    setError(null)
    const result = await onApprove(line.product, line.counted)
    setSaving(null)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setStatuses((current) => ({ ...current, [line.barcode]: 'applied' }))
  }

  const recount = (line: StocktakeLine) => {
    setStatuses((current) => ({ ...current, [line.barcode]: 'recount' }))
  }

  const matched = session?.lines.length ?? 0
  const mismatched = session?.lines.filter((l) => l.difference !== 0).length ?? 0

  return (
    <div className="screen">
      <section className="panel">
        <h2>Import a scan count</h2>
        <p className="muted">
          Set your scanner to storage/inventory mode and scan every item on the shelf as normal —
          scanning the same barcode twice counts two of it. When you're done, dock or connect the
          scanner and let it dump its memory into the box below (or paste it in), one code per
          line.
        </p>
        <form className="form" onSubmit={importDump}>
          <div className="field">
            <label htmlFor={dumpId}>Scanned barcodes</label>
            <textarea
              id={dumpId}
              rows={6}
              value={dump}
              placeholder={'5012345678917\n5012345678917\n4006381333931\n…'}
              onChange={(event) => setDump(event.target.value)}
            />
          </div>
          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            {session && (
              <button type="button" className="button button-ghost" onClick={startNewCount}>
                Start new count
              </button>
            )}
            <button type="submit" className="button button-primary">
              Import count
            </button>
          </div>
        </form>
      </section>

      {session && (
        <>
          <section className="panel">
            <header className="panel-header">
              <h2>Count results</h2>
              <button type="button" className="button" onClick={() => window.print()}>
                Print report
              </button>
            </header>
            <p className="muted">
              Imported {formatDateTime(session.importedAt)} · {formatNumber(matched)} barcodes
              matched · {formatNumber(mismatched)} don't match what's on hand ·{' '}
              {formatNumber(session.unmatched.length)} unrecognised.
            </p>
          </section>

          {session.lines.length === 0 ? (
            <p className="empty">No scanned barcodes matched a product in your catalogue.</p>
          ) : (
            <section className="panel">
              <h3>Counted items</h3>
              <ul className="plain-list">
                {session.lines.map((line) => {
                  const status = statuses[line.barcode] ?? 'pending'
                  return (
                    <li key={line.barcode} className="stocktake-row" data-testid="stocktake-row">
                      <div className="cart-identity">
                        <span className="product-name">{line.product.name}</span>
                        <span className="mono muted">{line.product.sku}</span>
                        <span className={`badge ${differenceClass(line.difference)}`}>
                          {differenceLabel(line.difference)}
                        </span>
                      </div>
                      <div className="stocktake-numbers">
                        <span>
                          Counted <strong>{formatNumber(line.counted)}</strong>
                        </span>
                        <span className="muted">
                          System <strong>{formatNumber(line.systemQuantity)}</strong>
                        </span>
                      </div>
                      {status === 'pending' ? (
                        <div className="toolbar-actions">
                          <button
                            type="button"
                            className="button button-ghost"
                            disabled={saving === line.barcode}
                            onClick={() => recount(line)}
                          >
                            Recount
                          </button>
                          <button
                            type="button"
                            className="button button-primary"
                            disabled={saving === line.barcode}
                            onClick={() => approve(line)}
                          >
                            {saving === line.barcode ? 'Saving…' : 'Approve'}
                          </button>
                        </div>
                      ) : (
                        <span className={`badge ${status === 'applied' ? 'badge-in' : 'badge-adjust'}`}>
                          {status === 'applied' ? 'Applied' : 'Flagged for recount'}
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          {session.unmatched.length > 0 && (
            <section className="panel">
              <h3>Unrecognised barcodes</h3>
              <p className="muted">
                Scanned, but not on any product yet — could be a mis-scan or something new.
              </p>
              <ul className="plain-list">
                {session.unmatched.map((code) => (
                  <li key={code.barcode} className="stocktake-row" data-testid="unmatched-row">
                    <span className="mono">{code.barcode || '(blank)'}</span>
                    <span className="muted">Scanned {formatNumber(code.counted)}×</span>
                    <button
                      type="button"
                      className="button button-ghost"
                      onClick={() => onCreateProduct(code.barcode)}
                    >
                      Add product
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Off-screen except when printing — @media print in styles.css hides
              everything else on the page and shows only this block. */}
          <div className="stocktake-report" aria-hidden="true">
            <h2>Stocktake report</h2>
            <p>{formatDateTime(session.importedAt)}</p>
            <table className="receipt-lines">
              <tbody>
                {session.lines.map((line) => (
                  <tr key={line.barcode}>
                    <td>
                      {line.product.name} ({line.product.sku})
                    </td>
                    <td className="receipt-amount">
                      counted {line.counted} · system {line.systemQuantity} ·{' '}
                      {differenceLabel(line.difference)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {session.unmatched.length > 0 && (
              <>
                <p className="receipt-total">Unrecognised barcodes</p>
                <table className="receipt-lines">
                  <tbody>
                    {session.unmatched.map((code) => (
                      <tr key={code.barcode}>
                        <td>{code.barcode || '(blank)'}</td>
                        <td className="receipt-amount">scanned {code.counted}×</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
