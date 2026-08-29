import { useState } from 'react'
import type { Role } from '../../data/repository'
import { lowStockProducts, summarise } from '../../domain/inventory'
import { findDeadStock, rollingDateRange } from '../../domain/profitability'
import { generateSalesReport } from '../../domain/reports'
import { salesSince, summariseSales } from '../../domain/sales'
import {
  MOVEMENT_LABELS,
  PAYMENT_METHOD_LABELS,
  type Product,
  type Sale,
  type StockMovement,
} from '../../domain/types'
import { formatCurrency, formatDateTime, formatDelta, formatNumber } from '../format'
import type { Tab } from '../components/Nav'

/** How far back the "Top profit makers" / "Not moving" panels look — a
 * rolling window (recomputed every render off the real clock) rather than a
 * fixed period, so the Dashboard always answers "lately," not some
 * calendar-month a manager has to remember to reset. 30 days is long enough
 * to smooth out a quiet week, short enough that the ranking still reflects
 * what's actually selling right now rather than the whole shop history. */
const PERFORMANCE_WINDOW_DAYS = 30

/** How long a line can sit with no sale before it's flagged as dead stock —
 * see `findDeadStock`'s own doc comment in `domain/profitability.ts` for the
 * full reasoning (mirrors, and is deliberately longer than, the 30-day
 * performance window above so a line isn't flagged the moment it drops out
 * of the "lately" ranking). */
const DEAD_STOCK_THRESHOLD_DAYS = 60

export interface DashboardScreenProps {
  products: Product[]
  role: Role
  movements: StockMovement[]
  sales: Sale[]
  onNavigate: (tab: Tab) => void
}

/** Midnight, local time. */
function startOfToday(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

/** Which stat tile, if any, has its detail panel open below the stat grids. */
type DetailKey = 'products' | 'units' | 'low' | 'out' | 'sales'

interface StatProps {
  id: string
  label: string
  value: string
  tone?: 'warn' | 'danger'
  active: boolean
  onClick: () => void
}

/** Every stat tile is a button — clicking one opens (or closes, if it's
 * already open) a detail panel below the stat grids showing exactly which
 * products or sales make up that number. */
function Stat({ id, label, value, tone, active, onClick }: StatProps) {
  return (
    <button
      type="button"
      className={`stat stat-clickable ${tone ? `stat-${tone}` : ''} ${active ? 'stat-active' : ''}`}
      data-testid={id}
      aria-pressed={active}
      onClick={onClick}
    >
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </button>
  )
}

function ProductDetailRow({ product, highlight }: { product: Product; highlight?: 'reorder' | 'zero' }) {
  return (
    <li className="low-stock-item">
      <span className="low-stock-name">{product.name}</span>
      <span className="mono">{product.sku}</span>
      <span className={highlight === 'zero' ? 'delta delta-down' : 'low-stock-count'}>
        {highlight === 'reorder'
          ? `${formatNumber(product.quantity)} / ${product.reorderLevel}`
          : `${formatNumber(product.quantity)} on hand`}
      </span>
      {product.location && <span className="muted">{product.location}</span>}
    </li>
  )
}

export function DashboardScreen({ products, role, movements, sales, onNavigate }: DashboardScreenProps) {
  const summary = summarise(products)
  const low = lowStockProducts(products)
  const outOfStock = products.filter((p) => p.quantity === 0)
  const recent = movements.slice(0, 5)
  const names = Object.fromEntries(products.map((p) => [p.id, p.name]))
  const todaysSales = salesSince(sales, startOfToday())
  const today = summariseSales(todaysSales)

  // Manager-only, same as the profit stats above — these two panels are
  // both fundamentally "how is this product doing for me" data.
  const now = new Date()
  const recentPerformance =
    role === 'manager'
      ? generateSalesReport(sales, { dateRange: rollingDateRange(PERFORMANCE_WINDOW_DAYS, now) })
      : null
  const deadStock = role === 'manager' ? findDeadStock(products, sales, now, DEAD_STOCK_THRESHOLD_DAYS) : []

  const [detail, setDetail] = useState<DetailKey | null>(null)
  const toggle = (key: DetailKey) => setDetail((current) => (current === key ? null : key))

  const byName = (a: Product, b: Product) => a.name.localeCompare(b.name)
  const byQuantityDesc = (a: Product, b: Product) => b.quantity - a.quantity

  const DETAIL_TITLES: Record<DetailKey, string> = {
    products: 'All products',
    units: 'Units on hand, by product',
    low: 'Low stock',
    out: 'Out of stock',
    sales: "Today's sales",
  }

  return (
    <div className="screen">
      <section className="stats" aria-label="Inventory summary">
        <Stat
          id="stat-products"
          label="Products"
          value={formatNumber(summary.totalProducts)}
          active={detail === 'products'}
          onClick={() => toggle('products')}
        />
        <Stat
          id="stat-units"
          label="Units on hand"
          value={formatNumber(summary.totalUnits)}
          active={detail === 'units'}
          onClick={() => toggle('units')}
        />
        <Stat
          id="stat-low-stock"
          label="Low stock"
          value={formatNumber(summary.lowStockCount)}
          tone="warn"
          active={detail === 'low'}
          onClick={() => toggle('low')}
        />
        <Stat
          id="stat-out-of-stock"
          label="Out of stock"
          value={formatNumber(summary.outOfStockCount)}
          tone="danger"
          active={detail === 'out'}
          onClick={() => toggle('out')}
        />
      </section>

      <section className="stats" aria-label="Today's sales">
        <Stat
          id="stat-revenue-today"
          label="Revenue today"
          value={formatCurrency(today.revenue)}
          active={detail === 'sales'}
          onClick={() => toggle('sales')}
        />
        {role === 'manager' && (
          <Stat
            id="stat-profit-today"
            label="Profit today"
            value={formatCurrency(today.profit)}
            active={detail === 'sales'}
            onClick={() => toggle('sales')}
          />
        )}
      </section>

      {detail && (
        <section className="panel" data-testid="dashboard-detail">
          <header className="panel-header">
            <h2>{DETAIL_TITLES[detail]}</h2>
            <button type="button" className="button button-ghost" onClick={() => setDetail(null)}>
              Close
            </button>
          </header>

          {detail === 'products' &&
            (products.length === 0 ? (
              <p className="empty">No products yet.</p>
            ) : (
              <ul className="plain-list">
                {[...products].sort(byName).map((product) => (
                  <ProductDetailRow key={product.id} product={product} />
                ))}
              </ul>
            ))}

          {detail === 'units' &&
            (products.length === 0 ? (
              <p className="empty">No products yet.</p>
            ) : (
              <ul className="plain-list">
                {[...products].sort(byQuantityDesc).map((product) => (
                  <ProductDetailRow key={product.id} product={product} />
                ))}
              </ul>
            ))}

          {detail === 'low' &&
            (low.length === 0 ? (
              <p className="empty">Every line is above its reorder level.</p>
            ) : (
              <ul className="plain-list">
                {low.map((product) => (
                  <ProductDetailRow key={product.id} product={product} highlight="reorder" />
                ))}
              </ul>
            ))}

          {detail === 'out' &&
            (outOfStock.length === 0 ? (
              <p className="empty">Nothing is out of stock right now.</p>
            ) : (
              <ul className="plain-list">
                {outOfStock.map((product) => (
                  <ProductDetailRow key={product.id} product={product} highlight="zero" />
                ))}
              </ul>
            ))}

          {detail === 'sales' &&
            (todaysSales.length === 0 ? (
              <p className="empty">No sales yet today.</p>
            ) : (
              <ul className="plain-list">
                {todaysSales.map((sale) => (
                  <li key={sale.id} className="activity-item">
                    <span>{sale.channel || 'Unspecified'}</span>
                    <span className="mono">{formatCurrency(sale.subtotal)}</span>
                    {role === 'manager' && <span className="muted">profit {formatCurrency(sale.profit)}</span>}
                    <span className="muted">{PAYMENT_METHOD_LABELS[sale.paymentMethod]}</span>
                    <span className="muted">{formatDateTime(sale.createdAt)}</span>
                  </li>
                ))}
              </ul>
            ))}

          {(detail === 'products' || detail === 'units' || detail === 'low' || detail === 'out') && (
            <div className="dialog-actions">
              <button type="button" className="button button-ghost" onClick={() => onNavigate('products')}>
                All products
              </button>
            </div>
          )}
          {detail === 'sales' && (
            <div className="dialog-actions">
              <button type="button" className="button button-ghost" onClick={() => onNavigate('history')}>
                Full history
              </button>
            </div>
          )}
        </section>
      )}

      <section className="panel">
        <header className="panel-header">
          <h2>Needs reordering</h2>
          <button type="button" className="button button-ghost" onClick={() => onNavigate('products')}>
            All products
          </button>
        </header>

        {low.length === 0 ? (
          <p className="empty">Every line is above its reorder level.</p>
        ) : (
          <ul className="plain-list" data-testid="low-stock-list">
            {low.map((product) => (
              <li key={product.id} className="low-stock-item">
                <span className="low-stock-name">{product.name}</span>
                <span className="mono">{product.sku}</span>
                <span className="low-stock-count">
                  {formatNumber(product.quantity)} / {product.reorderLevel}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {role === 'manager' && recentPerformance && (
        <section className="panel" aria-label="Top profit makers">
          <header className="panel-header">
            <h2>Buy more of this</h2>
            <button type="button" className="button button-ghost" onClick={() => onNavigate('history')}>
              Full history
            </button>
          </header>

          <p className="muted" style={{ marginTop: 0 }}>
            Most profit earned in the last {PERFORMANCE_WINDOW_DAYS} days.
          </p>

          {recentPerformance.topProducts.length === 0 ? (
            <p className="empty">No sales in the last {PERFORMANCE_WINDOW_DAYS} days yet.</p>
          ) : (
            <ul className="plain-list" data-testid="top-performers-list">
              {recentPerformance.topProducts.map((product) => (
                <li key={product.sku} className="low-stock-item">
                  <span className="low-stock-name">{product.name}</span>
                  <span className="mono">{product.sku}</span>
                  <span className="delta delta-up">{formatCurrency(product.profit)} profit</span>
                  <span className="muted">{formatNumber(product.unitsSold)} sold</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {role === 'manager' && deadStock.length > 0 && (
        <section className="panel" aria-label="Dead stock">
          <header className="panel-header">
            <h2>Not moving</h2>
            <button type="button" className="button button-ghost" onClick={() => onNavigate('products')}>
              All products
            </button>
          </header>

          <p className="muted" style={{ marginTop: 0 }}>
            No sale in {DEAD_STOCK_THRESHOLD_DAYS}+ days — consider a discount instead of reordering.
          </p>

          <ul className="plain-list" data-testid="dead-stock-list">
            {deadStock.map((entry) => (
              <li key={entry.productId} className="low-stock-item">
                <span className="low-stock-name">{entry.name}</span>
                <span className="mono">{entry.sku}</span>
                <span className="delta delta-down">{formatCurrency(entry.costBasis)} tied up</span>
                <span className="muted">
                  {entry.daysSinceLastSale === null ? 'Never sold' : `${entry.daysSinceLastSale}d since last sale`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel">
        <header className="panel-header">
          <h2>Recent activity</h2>
          <button type="button" className="button button-ghost" onClick={() => onNavigate('history')}>
            Full history
          </button>
        </header>

        {recent.length === 0 ? (
          <p className="empty">No stock movements yet. Scan something to get started.</p>
        ) : (
          <ul className="plain-list">
            {recent.map((movement) => (
              <li key={movement.id} className="activity-item">
                <span>{names[movement.productId] ?? 'Deleted product'}</span>
                <span className={`delta delta-${movement.delta < 0 ? 'down' : 'up'}`}>
                  {formatDelta(movement.delta)}
                </span>
                <span className="muted">{MOVEMENT_LABELS[movement.type]}</span>
                <span className="muted">{formatDateTime(movement.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
