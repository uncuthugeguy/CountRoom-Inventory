import { useId, useMemo, useState } from 'react'
import { movementsToCsv, salesToCsv } from '../../domain/csv'
import {
  breakdownByChannel,
  breakdownByPaymentMethod,
  breakdownByProduct,
  salesSince,
  summariseSales,
} from '../../domain/sales'
import {
  MOVEMENT_LABELS,
  PAYMENT_METHOD_LABELS,
  type Product,
  type Sale,
  type StockMovement,
} from '../../domain/types'
import { downloadCsv, timestampedFilename } from '../csvDownload'
import { formatDateTime, formatDelta, formatNumber } from '../format'

export interface HistoryScreenProps {
  movements: StockMovement[]
  products: Product[]
  sales: Sale[]
}

type Mode = 'movements' | 'sales'
type Range = 'today' | '7d' | '30d' | 'all'

const RANGE_LABELS: Record<Range, string> = {
  today: 'Today',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  all: 'All time',
}

/** Midnight local time, or far enough back to include everything for "all". */
function rangeStart(range: Range): Date {
  const now = new Date()
  if (range === 'all') return new Date(0)
  if (range === 'today') {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate())
  }
  const days = range === '7d' ? 7 : 30
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
}

function MovementsView({ movements, products }: { movements: StockMovement[]; products: Product[] }) {
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
    <>
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
    </>
  )
}

function SalesView({ sales }: { sales: Sale[] }) {
  const [range, setRange] = useState<Range>('7d')

  const inRange = useMemo(() => salesSince(sales, rangeStart(range)), [sales, range])
  const summary = useMemo(() => summariseSales(inRange), [inRange])
  const byChannel = useMemo(() => breakdownByChannel(inRange), [inRange])
  const byPayment = useMemo(() => breakdownByPaymentMethod(inRange), [inRange])
  const byProduct = useMemo(() => breakdownByProduct(inRange), [inRange])

  return (
    <>
      <div className="toolbar">
        <div className="channel-picker" role="group" aria-label="Date range">
          {(Object.keys(RANGE_LABELS) as Range[]).map((value) => (
            <button
              key={value}
              type="button"
              className={`button chip-button ${range === value ? 'chip-button-active' : ''}`}
              aria-pressed={range === value}
              onClick={() => setRange(value)}
            >
              {RANGE_LABELS[value]}
            </button>
          ))}
        </div>
        <div className="toolbar-actions">
          <button
            type="button"
            className="button"
            onClick={() => downloadCsv(timestampedFilename('sales'), salesToCsv(inRange))}
          >
            Export sales CSV
          </button>
        </div>
      </div>

      <section className="stats" aria-label="Profit and loss summary">
        <div className="stat" data-testid="pl-revenue">
          <span className="stat-value">{summary.revenue.toFixed(2)}</span>
          <span className="stat-label">Revenue</span>
        </div>
        <div className="stat" data-testid="pl-cost">
          <span className="stat-value">{summary.cost.toFixed(2)}</span>
          <span className="stat-label">Cost of goods</span>
        </div>
        <div className="stat" data-testid="pl-profit">
          <span className="stat-value">{summary.profit.toFixed(2)}</span>
          <span className="stat-label">Profit</span>
        </div>
        <div className="stat" data-testid="pl-count">
          <span className="stat-value">{formatNumber(summary.saleCount)}</span>
          <span className="stat-label">Sales ({formatNumber(summary.itemsSold)} items)</span>
        </div>
      </section>

      {inRange.length === 0 ? (
        <p className="empty">No sales in this range yet.</p>
      ) : (
        <>
          <div className="field-row">
            <section className="panel">
              <h3>By channel</h3>
              <ul className="plain-list">
                {byChannel.map((row) => (
                  <li key={row.key} className="breakdown-row">
                    <span>{row.key}</span>
                    <span className="mono">{row.revenue.toFixed(2)}</span>
                    <span className="muted">profit {row.profit.toFixed(2)}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section className="panel">
              <h3>By payment method</h3>
              <ul className="plain-list">
                {byPayment.map((row) => (
                  <li key={row.key} className="breakdown-row">
                    <span>{PAYMENT_METHOD_LABELS[row.key as keyof typeof PAYMENT_METHOD_LABELS] ?? row.key}</span>
                    <span className="mono">{row.revenue.toFixed(2)}</span>
                    <span className="muted">profit {row.profit.toFixed(2)}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <section className="panel">
            <h3>Top products</h3>
            <ul className="plain-list">
              {byProduct.map((row) => (
                <li key={row.sku || row.name} className="breakdown-row" data-testid="product-breakdown-row">
                  <span>
                    {row.name} <span className="mono muted">{row.sku}</span>
                  </span>
                  <span className="mono">{formatNumber(row.unitsSold)} sold</span>
                  <span className="muted">
                    revenue {row.revenue.toFixed(2)} · profit {row.profit.toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <ul className="plain-list history-list">
            {inRange.map((sale) => (
              <li key={sale.id} className="history-row" data-testid="sale-row">
                <div className="history-main">
                  <span className="history-product">{sale.channel || 'Unspecified'}</span>
                  <span className="badge">{PAYMENT_METHOD_LABELS[sale.paymentMethod]}</span>
                </div>
                <div className="history-numbers">
                  <span className="mono">{sale.subtotal.toFixed(2)}</span>
                  <span className="muted">profit {sale.profit.toFixed(2)}</span>
                </div>
                <div className="history-meta">
                  <span className="muted">{formatDateTime(sale.createdAt)}</span>
                  <span className="reason">
                    {sale.lines.map((line) => `${line.quantity}x ${line.sku}`).join(', ')}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}

export function HistoryScreen({ movements, products, sales }: HistoryScreenProps) {
  const [mode, setMode] = useState<Mode>('movements')

  return (
    <div className="screen">
      <div className="channel-picker">
        <button
          type="button"
          className={`button chip-button ${mode === 'movements' ? 'chip-button-active' : ''}`}
          aria-pressed={mode === 'movements'}
          onClick={() => setMode('movements')}
        >
          Stock movements
        </button>
        <button
          type="button"
          className={`button chip-button ${mode === 'sales' ? 'chip-button-active' : ''}`}
          aria-pressed={mode === 'sales'}
          onClick={() => setMode('sales')}
        >
          Sales
        </button>
      </div>

      {mode === 'movements' ? (
        <MovementsView movements={movements} products={products} />
      ) : (
        <SalesView sales={sales} />
      )}
    </div>
  )
}
