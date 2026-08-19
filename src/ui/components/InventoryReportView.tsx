import type { InventoryReport, CategoryMetrics } from '../../domain/reports'
import { formatCurrency } from '../format'
import { MetricsCard, MetricsGrid } from './SalesReportView'

interface CategoryTableProps {
  categories: CategoryMetrics[]
}

function CategoryTable({ categories }: CategoryTableProps) {
  if (categories.length === 0) {
    return (
      <div className="text-center py-6 text-gray-500">
        No categories to display
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-gray-100 border-b">
            <th className="text-left py-2 px-3 text-gray-700">Category</th>
            <th className="text-right py-2 px-3 text-gray-700">Products</th>
            <th className="text-right py-2 px-3 text-gray-700">Units</th>
            <th className="text-right py-2 px-3 text-gray-700">Out of Stock</th>
            <th className="text-right py-2 px-3 text-gray-700">Low Stock</th>
            <th className="text-right py-2 px-3 text-gray-700">Cost Basis</th>
          </tr>
        </thead>
        <tbody>
          {categories.map((cat, i) => (
            <tr key={i} className="border-b hover:bg-gray-50">
              <td className="py-2 px-3 text-gray-900 font-medium">{cat.category}</td>
              <td className="py-2 px-3 text-right text-gray-900">{cat.productCount}</td>
              <td className="py-2 px-3 text-right font-semibold text-gray-900">
                {cat.totalUnits}
              </td>
              <td className="py-2 px-3 text-right">
                <span className={cat.outOfStock > 0 ? 'font-semibold text-red-700' : 'text-gray-900'}>
                  {cat.outOfStock}
                </span>
              </td>
              <td className="py-2 px-3 text-right">
                <span className={cat.lowStock > 0 ? 'font-semibold text-yellow-700' : 'text-gray-900'}>
                  {cat.lowStock}
                </span>
              </td>
              <td className="py-2 px-3 text-right text-gray-900">
                {formatCurrency(cat.totalCostBasis)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
  if (products.length === 0) {
    return null
  }

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <h3 className="font-semibold text-gray-900">{title}</h3>
        <span className={`px-2 py-1 rounded text-xs font-semibold ${
          warning ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
        }`}>
          {products.length}
        </span>
      </div>
      <div className="space-y-2">
        {products.map((product, i) => (
          <div key={i} className={`p-3 rounded border ${
            warning ? 'bg-red-50 border-red-200' : 'bg-yellow-50 border-yellow-200'
          }`}>
            <div className="flex justify-between items-start mb-1">
              <div>
                <div className="font-semibold text-gray-900">{product.name}</div>
                <div className="text-xs text-gray-600">{product.sku} · {product.category}</div>
              </div>
              {product.quantity !== undefined && (
                <div className="text-right">
                  <div className={`font-bold ${
                    product.quantity === 0 ? 'text-red-700' : 'text-yellow-700'
                  }`}>
                    {product.quantity} units
                  </div>
                  {product.reorderLevel !== undefined && (
                    <div className="text-xs text-gray-600">
                      Reorder at: {product.reorderLevel}
                    </div>
                  )}
                </div>
              )}
            </div>
            {product.lastMovement && (
              <div className="text-xs text-gray-600 mt-2">
                Last movement: {new Date(product.lastMovement).toLocaleDateString()}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

interface InventoryReportViewProps {
  report: InventoryReport
}

export function InventoryReportView({ report }: InventoryReportViewProps) {
  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Inventory Report</h2>
        <p className="text-sm text-gray-600 mb-4">
          As of {new Date(report.timestamp).toLocaleString()}
        </p>

        <h3 className="font-semibold text-gray-900 mb-3">Overview</h3>
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
          <MetricsCard
            label="Cost Basis"
            value={formatCurrency(report.overall.totalCostBasis)}
          />
          <MetricsCard
            label="Avg Cost/Unit"
            value={formatCurrency(report.overall.averageCostPerUnit)}
          />
        </MetricsGrid>
      </div>

      {report.byCategory.length > 0 && (
        <div className="mb-6">
          <h3 className="font-semibold text-gray-900 mb-3">By Category</h3>
          <CategoryTable categories={report.byCategory} />
        </div>
      )}

      <ProductList
        title="Out of Stock Products"
        products={report.outOfStockProducts}
        warning
      />

      <ProductList
        title="Low Stock Products"
        products={report.lowStockProducts}
        warning={false}
      />
    </div>
  )
}
