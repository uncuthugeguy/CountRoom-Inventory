import { useMemo, useState } from 'react'
import { generateSalesReport, generateInventoryReport, generateMovementReport } from '../../domain/reports'
import type { DateRange } from '../../domain/reports'
import type { Product, Sale, StockMovement } from '../../domain/types'
import { SalesReportView } from '../components/SalesReportView'
import { InventoryReportView } from '../components/InventoryReportView'
import { MovementReportView } from '../components/MovementReportView'
import { DateRangeSelector } from '../components/DateRangeSelector'

type ReportType = 'sales' | 'inventory' | 'movements'

export interface ReportsScreenProps {
  products: Product[]
  sales: Sale[]
  movements: StockMovement[]
}

export function ReportsScreen({ products, sales, movements }: ReportsScreenProps) {
  const [reportType, setReportType] = useState<ReportType>('sales')
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const end = today.toISOString().split('T')[0]

    const monthAgo = new Date(today)
    monthAgo.setMonth(monthAgo.getMonth() - 1)
    const start = monthAgo.toISOString().split('T')[0]

    return { start, end }
  })

  const salesReport = useMemo(
    () => generateSalesReport(sales, { dateRange }),
    [sales, dateRange],
  )

  const inventoryReport = useMemo(
    () => generateInventoryReport(products, movements),
    [products, movements],
  )

  const movementReport = useMemo(
    () => generateMovementReport(movements, { dateRange }, products),
    [movements, dateRange, products],
  )

  return (
    <div className="screen">
      <h1 className="screen-title">Reports</h1>

      <div className="channel-picker report-tabs">
        {[
          { type: 'sales' as const, label: 'Sales' },
          { type: 'inventory' as const, label: 'Inventory' },
          { type: 'movements' as const, label: 'Movements' },
        ].map(({ type, label }) => (
          <button
            key={type}
            type="button"
            onClick={() => setReportType(type)}
            className={`button chip-button ${reportType === type ? 'chip-button-active' : ''}`}
          >
            {label}
          </button>
        ))}
      </div>

      {reportType !== 'inventory' && (
        <DateRangeSelector value={dateRange} onChange={setDateRange} />
      )}

      <div className="panel">
        {reportType === 'sales' && <SalesReportView report={salesReport} />}
        {reportType === 'inventory' && <InventoryReportView report={inventoryReport} />}
        {reportType === 'movements' && <MovementReportView report={movementReport} />}
      </div>
    </div>
  )
}
