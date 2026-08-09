import type { Role } from '../../data/repository'
import { lowStockProducts, summarise } from '../../domain/inventory'
import { salesSince, summariseSales } from '../../domain/sales'
import { MOVEMENT_LABELS, type Product, type Sale, type StockMovement } from '../../domain/types'
import { formatDateTime, formatDelta, formatNumber } from '../format'
import type { Tab } from '../components/Nav'

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

interface StatProps {
  id: string
  label: string
  value: number
  tone?: 'warn' | 'danger'
}

function Stat({ id, label, value, tone }: StatProps) {
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ''}`} data-testid={id}>
      <span className="stat-value">{formatNumber(value)}</span>
      <span className="stat-label">{label}</span>
    </div>
  )
}

export function DashboardScreen({ products, role, movements, sales, onNavigate }: DashboardScreenProps) {
  const summary = summarise(products)
  const low = lowStockProducts(products)
  const recent = movements.slice(0, 5)
  const names = Object.fromEntries(products.map((p) => [p.id, p.name]))
  const today = summariseSales(salesSince(sales, startOfToday()))

  return (
    <div className="screen">
      <section className="stats" aria-label="Inventory summary">
        <Stat id="stat-products" label="Products" value={summary.totalProducts} />
        <Stat id="stat-units" label="Units on hand" value={summary.totalUnits} />
        <Stat id="stat-low-stock" label="Low stock" value={summary.lowStockCount} tone="warn" />
        <Stat
          id="stat-out-of-stock"
          label="Out of stock"
          value={summary.outOfStockCount}
          tone="danger"
        />
      </section>

      <section className="stats" aria-label="Today's sales">
        <div className="stat" data-testid="stat-revenue-today">
          <span className="stat-value">{today.revenue.toFixed(2)}</span>
          <span className="stat-label">Revenue today</span>
        </div>
        {role === 'manager' && (
          <div className="stat" data-testid="stat-profit-today">
            <span className="stat-value">{today.profit.toFixed(2)}</span>
            <span className="stat-label">Profit today</span>
          </div>
        )}
      </section>

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
