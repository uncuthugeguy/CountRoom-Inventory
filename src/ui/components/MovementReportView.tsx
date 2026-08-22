import type { MovementReport } from '../../domain/reports'
import { MetricsCard, MetricsGrid } from './SalesReportView'

interface MovementReportViewProps {
  report: MovementReport
}

const TYPE_LABELS: Record<'in' | 'out' | 'adjust', string> = {
  in: 'Stock In',
  out: 'Stock Out',
  adjust: 'Adjustments',
}

export function MovementReportView({ report }: MovementReportViewProps) {
  return (
    <div className="screen">
      <p className="muted">
        {report.period.start} to {report.period.end}
      </p>

      <div className="report-section">
        <h3>Summary</h3>
        <MetricsGrid>
          <MetricsCard label="Stock In" value={report.metrics.totalStockIn} />
          <MetricsCard label="Stock Out" value={report.metrics.totalStockOut} />
          <MetricsCard label="Adjustments" value={report.metrics.totalAdjustments} />
          <MetricsCard
            label="Net Movement"
            value={report.metrics.netMovement}
            highlight={report.metrics.netMovement !== 0}
          />
        </MetricsGrid>
      </div>

      {report.byType.length > 0 && (
        <div className="report-section">
          <h3>By movement type</h3>
          <div className="stats">
            {report.byType.map((mt) => (
              <div key={mt.type} className="stat">
                <span className="stat-value">{mt.count}</span>
                <span className="stat-label">{TYPE_LABELS[mt.type]}</span>
                <span className="stat-subtext">
                  {mt.totalQuantity} units {mt.type === 'out' ? 'removed' : 'moved'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {report.topProducts.length > 0 && (
        <div className="report-section">
          <h3>Most active products</h3>
          <ul className="plain-list">
            {report.topProducts.map((product) => (
              <li key={product.productId} className="report-row">
                <div className="report-row-header">
                  <span className="report-row-title">
                    {product.name} <span className="mono muted">{product.sku}</span>
                  </span>
                  <span className={`report-row-value ${product.netMovement < 0 ? 'quantity-low' : ''}`}>
                    {product.netMovement > 0 ? '+' : ''}
                    {product.netMovement}
                  </span>
                </div>
                <div className="report-row-metrics">
                  <div>
                    <span className="report-metric-label">In</span>
                    <span className="report-metric-value">+{product.inCount}</span>
                  </div>
                  <div>
                    <span className="report-metric-label">Out</span>
                    <span className="report-metric-value">-{product.outCount}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
