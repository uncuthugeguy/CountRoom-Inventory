import { useId, useMemo, useState } from 'react'
import { movementsToCsv } from '../../domain/csv'
import { MOVEMENT_LABELS, type Product, type StockMovement } from '../../domain/types'
import { downloadCsv, timestampedFilename } from '../csvDownload'
import { formatDateTime, formatDelta } from '../format'

export interface HistoryScreenProps {
  movements: StockMovement[]
  products: Product[]
}

export function HistoryScreen({ movements, products }: HistoryScreenProps) {
  const searchId = useId()
  const [query, setQuery] = useState('')

  const names = useMemo(
    () => Object.fromEntries(products.map((p) => [p.id, p.name])),
    [products],
  )

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return movements
    return movements.filter((movement) =>
      [names[movement.productId] ?? '', movement.reason ?? '', MOVEMENT_LABELS[movement.type]]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    )
  }, [movements, names, query])

  return (
    <div className="screen">
      <div className="toolbar">
        <div className="field field-grow">
          <label htmlFor={searchId}>Search history</label>
          <input
            id={searchId}
            type="search"
            value={query}
            autoComplete="off"
            placeholder="Product, reason or movement type"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="toolbar-actions">
          <button
            type="button"
            className="button"
            onClick={() =>
              downloadCsv(timestampedFilename('stock-history'), movementsToCsv(visible, names))
            }
          >
            Export history CSV
          </button>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="empty">
          {movements.length === 0
            ? 'No stock movements yet. Every stock in, out and adjustment lands here.'
            : 'No movements match that search.'}
        </p>
      ) : (
        <ul className="plain-list history-list">
          {visible.map((movement) => (
            <li key={movement.id} className="history-row" data-testid="movement-row">
              <div className="history-main">
                <span className="history-product">
                  {names[movement.productId] ?? 'Deleted product'}
                </span>
                <span className={`badge badge-${movement.type}`}>
                  {MOVEMENT_LABELS[movement.type]}
                </span>
              </div>
              <div className="history-numbers">
                <span className={`delta delta-${movement.delta < 0 ? 'down' : 'up'}`}>
                  {formatDelta(movement.delta)}
                </span>
                <span className="muted">
                  {movement.previousQuantity} → {movement.newQuantity}
                </span>
              </div>
              <div className="history-meta">
                <span className="muted">{formatDateTime(movement.createdAt)}</span>
                {movement.reason && <span className="reason">{movement.reason}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
