import type { SalesReport, ChannelMetrics, SalesMetrics } from '../../domain/reports'
import { formatCurrency, formatPercent } from '../format'

interface MetricsCardProps {
  label: string
  value: string | number
  subtext?: string
  highlight?: boolean
}

/** A single number tile — reuses the app's existing .stat styling (the same
 * one Dashboard's summary row uses) rather than one-off report-only CSS. */
export function MetricsCard({ label, value, subtext, highlight }: MetricsCardProps) {
  return (
    <div className={`stat ${highlight ? 'stat-warning' : ''}`}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
      {subtext && <span className="stat-subtext">{subtext}</span>}
    </div>
  )
}

interface MetricsGridProps {
  children: React.ReactNode
}

export function MetricsGrid({ children }: MetricsGridProps) {
  return <div className="stats">{children}</div>
}

interface SalesMetricsDisplayProps {
  metrics: SalesMetrics
  highlight?: boolean
}

export function SalesMetricsDisplay({ metrics, highlight }: SalesMetricsDisplayProps) {
  return (
    <>
      <MetricsCard label="Total Sales" value={metrics.totalSales} highlight={highlight} />
      <MetricsCard label="Revenue" value={formatCurrency(metrics.totalRevenue)} />
      <MetricsCard
        label="Profit"
        value={formatCurrency(metrics.totalProfit)}
        subtext={`${formatPercent(metrics.profitMargin)}% margin`}
        highlight={highlight}
      />
      <MetricsCard label="Items Sold" value={metrics.itemsUnitsSold} />
      <MetricsCard label="Avg Order" value={formatCurrency(metrics.averageOrderValue)} />
      <MetricsCard label="Avg Profit" value={formatCurrency(metrics.averageProfitPerOrder)} />
      {metrics.feesDeducted > 0 && (
        <MetricsCard label="Fees" value={formatCurrency(metrics.feesDeducted)} />
      )}
    </>
  )
}

interface ChannelBreakdownProps {
  channels: ChannelMetrics[]
}

export function ChannelBreakdown({ channels }: ChannelBreakdownProps) {
  if (channels.length === 0) {
    return <p className="empty">No sales by channel to display.</p>
  }

  return (
    <ul className="plain-list">
      {channels.map((channel) => (
        <li key={channel.channel} className="report-row">
          <div className="report-row-header">
            <span className="report-row-title">{channel.channel}</span>
            <span className="report-row-value">{formatCurrency(channel.totalProfit)}</span>
          </div>
          <div className="report-row-metrics">
            <div>
              <span className="report-metric-label">Sales</span>
              <span className="report-metric-value">{channel.totalSales}</span>
            </div>
            <div>
              <span className="report-metric-label">Revenue</span>
              <span className="report-metric-value">{formatCurrency(channel.totalRevenue)}</span>
            </div>
            <div>
              <span className="report-metric-label">Cost</span>
              <span className="report-metric-value">{formatCurrency(channel.totalCost)}</span>
            </div>
            <div>
              <span className="report-metric-label">Margin</span>
              <span className={`report-metric-value ${channel.profitMargin >= 20 ? '' : 'quantity-low'}`}>
                {formatPercent(channel.profitMargin)}%
              </span>
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

interface ProductTableProps {
  title: string
  products: Array<{
    name: string
    sku: string
    unitsSold: number
    revenue: number
    profit: number
  }>
}

export function ProductTable({ title, products }: ProductTableProps) {
  if (products.length === 0) return null

  return (
    <div className="report-section">
      <h3>{title}</h3>
      <ul className="plain-list">
        {products.map((product, i) => (
          <li key={i} className="report-row">
            <div className="report-row-header">
              <span className="report-row-title">
                {product.name} <span className="mono muted">{product.sku}</span>
              </span>
              <span className={`report-row-value ${product.profit >= 0 ? '' : 'quantity-low'}`}>
                {formatCurrency(product.profit)}
              </span>
            </div>
            <div className="report-row-metrics">
              <div>
                <span className="report-metric-label">Units sold</span>
                <span className="report-metric-value">{product.unitsSold}</span>
              </div>
              <div>
                <span className="report-metric-label">Revenue</span>
                <span className="report-metric-value">{formatCurrency(product.revenue)}</span>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

interface SalesReportViewProps {
  report: SalesReport
}

export function SalesReportView({ report }: SalesReportViewProps) {
  return (
    <div className="screen">
      <p className="muted">
        {report.period.start} to {report.period.end}
      </p>

      <div className="report-section">
        <h3>Overall performance</h3>
        <MetricsGrid>
          <SalesMetricsDisplay metrics={report.overall} highlight />
        </MetricsGrid>
      </div>

      {report.byChannel.length > 0 && (
        <div className="report-section">
          <h3>By channel</h3>
          <ChannelBreakdown channels={report.byChannel} />
        </div>
      )}

      <ProductTable title="Top 5 products by profit" products={report.topProducts} />
      <ProductTable title="Bottom 5 products by profit" products={report.bottomProducts} />
    </div>
  )
}
