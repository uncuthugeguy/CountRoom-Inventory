import type { InventoryReport, CategoryMetrics } from '../../domain/reports'
import { formatCurrency } from '../format'
import { MetricsCard, MetricsGrid } from './SalesReportView'

interface CategoryTableProps {
  categories: CategoryMetrics[]
}

function CategoryTable({ categories }: CategoryTableProps) {
  if (categories.length === 0) {
    return <p className="empty">No categories to display.</p>
  }

  return (
    <ul className="plain-list">
      {categories.map((cat, i) => (
        <li key={i} className="report-row">
          <div className="report-row-header">
            {/* A product with no category set groups under '' — label it
                rather than rendering a blank, unreadable row. */}
            <span className="report-row-title">{cat.category || 'Uncategorised'}</span>
            <span className="report-row-value">{formatCurrency(cat.totalCostBasis)}</span>
          </div>
          <div className="report-row-metrics">
            <div>
              <span className="report-metric-label">Products</span>
              <span className="report-metric-value">{cat.productCount}</span>
            </div>
            <div>
              <span className="report-metric-label">Units</span>
              <span className="report-metric-value">{cat.totalUnits}</span>
            </div>
            <div>
              <span className="report-metric-label">Out of stock</span>
              <span className={`report-metric-value ${cat.outOfStock > 0 ? 'quantity-low' : ''}`}>
                {cat.outOfStock}
              </span>
            </div>
            <div>
              <span className="report-metric-label">Low stock</span>
              <span className={`report-metric-value ${cat.lowStock > 0 ? 'quantity-low' : ''}`}>
                {cat.lowStock}
              </span>
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

interface ProductListProps {
  title: string
  products: Array<{
    name: string
    sku: string
    category: string
    quantity?: number
    reorderLevel?: number
    lastMovement?: string
  }>
  warning?: boolean
}

function ProductList({ title, products, warning }: ProductListProps) {
  if (products.length === 0) return null

  return (
    <div className="report-section">
      <h3>
        {title} <span className="chip">{products.length}</span>
      </h3>
      <ul className="plain-list">
        {products.map((product, i) => (
          <li key={i} className="low-stock-item">
            <span className="low-stock-name">{product.name || 'Unnamed product'}</span>
            <span className="mono muted">{product.sku}</span>
            {product.quantity !== undefined && (
              <span className={warning ? 'delta delta-down' : 'low-stock-count'}>
                {product.reorderLevel !== undefined
                  ? `${product.quantity} / ${product.reorderLevel} on hand`
                  : `${product.quantity} on hand`}
              </span>
            )}
            {product.category && <span className="muted">{product.category}</span>}
            {product.lastMovement && (
              <span className="muted">
                Last movement: {new Date(product.lastMovement).toLocaleDateString()}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

interface InventoryReportViewProps {
  report: InventoryReport
}

export function InventoryReportView({ report }: InventoryReportViewProps) {
  return (
    <div className="screen">
      <p className="muted">As of {new Date(report.timestamp).toLocaleString()}</p>

      <div className="report-section">
        <h3>Overview</h3>
        <MetricsGrid>
          <MetricsCard label="Total Products" value={report.overall.totalProducts} />
          <MetricsCard label="Total Units" value={report.overall.totalUnits} highlight />
          <MetricsCard
            label="Out of Stock"
            value={report.overall.outOfStock}
            highlight={report.overall.outOfStock > 0}
          />
          <MetricsCard
            label="Low Stock"
            value={report.overall.lowStock}
            highlight={report.overall.lowStock > 0}
          />
          <MetricsCard label="Cost Basis" value={formatCurrency(report.overall.totalCostBasis)} />
          <MetricsCard label="Avg Cost/Unit" value={formatCurrency(report.overall.averageCostPerUnit)} />
        </MetricsGrid>
      </div>

      {report.byCategory.length > 0 && (
        <div className="report-section">
          <h3>By category</h3>
          <CategoryTable categories={report.byCategory} />
        </div>
      )}

      <ProductList title="Out of stock products" products={report.outOfStockProducts} warning />
      <ProductList title="Low stock products" products={report.lowStockProducts} />
    </div>
  )
}
