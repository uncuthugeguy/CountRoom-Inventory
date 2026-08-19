import { Fragment } from 'react'
import type { SalesReport, ChannelMetrics, SalesMetrics } from '../../domain/reports'
import { formatCurrency, formatPercent } from '../format'

interface MetricsCardProps {
  label: string
  value: string | number
  subtext?: string
  highlight?: boolean
}

export function MetricsCard({ label, value, subtext, highlight }: MetricsCardProps) {
  return (
    <div className={`p-3 rounded border ${highlight ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-200'}`}>
      <div className="text-xs text-gray-500 font-medium mb-1">{label}</div>
      <div className={`text-lg font-bold ${highlight ? 'text-blue-700' : 'text-gray-900'}`}>{value}</div>
      {subtext && <div className="text-xs text-gray-600 mt-1">{subtext}</div>}
    </div>
  )
}

interface MetricsGridProps {
  children: React.ReactNode
}

export function MetricsGrid({ children }: MetricsGridProps) {
  return <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">{children}</div>
}

interface SalesMetricsDisplayProps {
  metrics: SalesMetrics
  highlight?: boolean
}

export function SalesMetricsDisplay({ metrics, highlight }: SalesMetricsDisplayProps) {
  return (
    <Fragment>
      <MetricsCard
        label="Total Sales"
        value={metrics.totalSales}
        highlight={highlight}
      />
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
    </Fragment>
  )
}

interface ChannelBreakdownProps {
  channels: ChannelMetrics[]
}

export function ChannelBreakdown({ channels }: ChannelBreakdownProps) {
  if (channels.length === 0) {
    return (
      <div className="text-center py-6 text-gray-500">
        No sales by channel to display
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {channels.map((channel) => (
        <div key={channel.channel} className="p-4 border rounded bg-white">
          <div className="flex justify-between items-start mb-2">
            <h4 className="font-semibold text-gray-900">{channel.channel}</h4>
            <span className="text-sm font-bold text-green-700">
              {formatCurrency(channel.totalProfit)}
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
            <div>
              <div className="text-gray-500 text-xs">Sales</div>
              <div className="font-semibold text-gray-900">{channel.totalSales}</div>
            </div>
            <div>
              <div className="text-gray-500 text-xs">Revenue</div>
              <div className="font-semibold text-gray-900">{formatCurrency(channel.totalRevenue)}</div>
            </div>
            <div>
              <div className="text-gray-500 text-xs">Cost</div>
              <div className="font-semibold text-gray-900">{formatCurrency(channel.totalCost)}</div>
            </div>
            <div>
              <div className="text-gray-500 text-xs">Margin</div>
              <div className={`font-semibold ${channel.profitMargin >= 20 ? 'text-green-700' : 'text-yellow-700'}`}>
                {formatPercent(channel.profitMargin)}%
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
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
  if (products.length === 0) {
    return null
  }

  return (
    <div className="mb-6">
      <h3 className="font-semibold text-gray-900 mb-3">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-100 border-b">
              <th className="text-left py-2 px-3 text-gray-700">Product</th>
              <th className="text-left py-2 px-3 text-gray-700">SKU</th>
              <th className="text-right py-2 px-3 text-gray-700">Units</th>
              <th className="text-right py-2 px-3 text-gray-700">Revenue</th>
              <th className="text-right py-2 px-3 text-gray-700">Profit</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product, i) => (
              <tr key={i} className="border-b hover:bg-gray-50">
                <td className="py-2 px-3 text-gray-900 font-medium">{product.name}</td>
                <td className="py-2 px-3 text-gray-600">{product.sku}</td>
                <td className="py-2 px-3 text-right font-semibold text-gray-900">
                  {product.unitsSold}
                </td>
                <td className="py-2 px-3 text-right text-gray-900">
                  {formatCurrency(product.revenue)}
                </td>
                <td className="py-2 px-3 text-right font-semibold text-green-700">
                  {formatCurrency(product.profit)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

interface SalesReportViewProps {
  report: SalesReport
}

export function SalesReportView({ report }: SalesReportViewProps) {
  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Sales Report</h2>
        <p className="text-sm text-gray-600 mb-4">
          {report.period.start} to {report.period.end}
        </p>

        <h3 className="font-semibold text-gray-900 mb-3">Overall Performance</h3>
        <MetricsGrid>
          <SalesMetricsDisplay metrics={report.overall} highlight />
        </MetricsGrid>
      </div>

      {report.byChannel.length > 0 && (
        <div className="mb-6">
          <h3 className="font-semibold text-gray-900 mb-3">By Channel</h3>
          <ChannelBreakdown channels={report.byChannel} />
        </div>
      )}

      <ProductTable title="Top 5 Products by Profit" products={report.topProducts} />
      <ProductTable title="Bottom 5 Products by Profit" products={report.bottomProducts} />
    </div>
  )
}
