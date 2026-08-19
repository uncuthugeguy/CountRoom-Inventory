import type { MovementReport } from '../../domain/reports'
import { MetricsCard, MetricsGrid } from './SalesReportView'

interface MovementReportViewProps {
  report: MovementReport
}

export function MovementReportView({ report }: MovementReportViewProps) {
  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Stock Movement Report</h2>
        <p className="text-sm text-gray-600 mb-4">
          {report.period.start} to {report.period.end}
        </p>

        <h3 className="font-semibold text-gray-900 mb-3">Summary</h3>
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
        <div className="mb-6">
          <h3 className="font-semibold text-gray-900 mb-3">By Movement Type</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {report.byType.map((mt) => (
              <div key={mt.type} className="p-4 rounded border bg-white">
                <div className="text-xs text-gray-500 font-medium mb-2 capitalize">
                  {mt.type === 'in' ? 'Stock In' : mt.type === 'out' ? 'Stock Out' : 'Adjustments'}
                </div>
                <div className="font-bold text-2xl text-gray-900 mb-1">{mt.count}</div>
                <div className="text-sm text-gray-600">
                  {mt.totalQuantity} units {mt.type === 'out' ? 'removed' : 'moved'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {report.topProducts.length > 0 && (
        <div className="mb-6">
          <h3 className="font-semibold text-gray-900 mb-3">Most Active Products</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-100 border-b">
                  <th className="text-left py-2 px-3 text-gray-700">Product</th>
                  <th className="text-left py-2 px-3 text-gray-700">SKU</th>
                  <th className="text-right py-2 px-3 text-gray-700">In</th>
                  <th className="text-right py-2 px-3 text-gray-700">Out</th>
                  <th className="text-right py-2 px-3 text-gray-700">Net</th>
                </tr>
              </thead>
              <tbody>
                {report.topProducts.map((product, i) => (
                  <tr key={i} className="border-b hover:bg-gray-50">
                    <td className="py-2 px-3 text-gray-900 font-medium">{product.name}</td>
                    <td className="py-2 px-3 text-gray-600">{product.sku}</td>
                    <td className="py-2 px-3 text-right text-green-700 font-semibold">
                      +{product.inCount}
                    </td>
                    <td className="py-2 px-3 text-right text-red-700 font-semibold">
                      -{product.outCount}
                    </td>
                    <td className="py-2 px-3 text-right font-semibold text-gray-900">
                      {product.netMovement > 0 ? '+' : ''}{product.netMovement}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
