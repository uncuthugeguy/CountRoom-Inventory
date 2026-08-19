import { useMemo } from 'react'
import type { DateRange } from '../../domain/reports'

interface DateRangeSelectorProps {
  value: DateRange
  onChange: (range: DateRange) => void
}

type PredefinedRange = 'today' | 'week' | 'month' | '3months' | 'year' | 'all' | 'custom'

/** Calculate date ranges for common periods */
function getPredefinedRange(type: PredefinedRange): DateRange | null {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const end = today.toISOString().split('T')[0]
  let start: string

  switch (type) {
    case 'today':
      start = end
      break
    case 'week': {
      const weekAgo = new Date(today)
      weekAgo.setDate(weekAgo.getDate() - 7)
      start = weekAgo.toISOString().split('T')[0]
      break
    }
    case 'month': {
      const monthAgo = new Date(today)
      monthAgo.setMonth(monthAgo.getMonth() - 1)
      start = monthAgo.toISOString().split('T')[0]
      break
    }
    case '3months': {
      const threeMonthsAgo = new Date(today)
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)
      start = threeMonthsAgo.toISOString().split('T')[0]
      break
    }
    case 'year': {
      const yearAgo = new Date(today)
      yearAgo.setFullYear(yearAgo.getFullYear() - 1)
      start = yearAgo.toISOString().split('T')[0]
      break
    }
    case 'all':
      // Arbitrarily start from 10 years ago
      start = new Date(today.getFullYear() - 10, 0, 1).toISOString().split('T')[0]
      break
    case 'custom':
      return null
  }

  return { start, end }
}

/** Detect which predefined range this is, or 'custom' if none match */
function detectPredefinedRange(range: DateRange): PredefinedRange {
  for (const type of ['today', 'week', 'month', '3months', 'year', 'all'] as const) {
    const predefined = getPredefinedRange(type)
    if (predefined && predefined.start === range.start && predefined.end === range.end) {
      return type
    }
  }
  return 'custom'
}

export function DateRangeSelector({ value, onChange }: DateRangeSelectorProps) {
  const currentType = useMemo(() => detectPredefinedRange(value), [value])

  const handlePredefined = (type: Exclude<PredefinedRange, 'custom'>) => {
    const range = getPredefinedRange(type)
    if (range) onChange(range)
  }

  const handleStartDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ ...value, start: e.target.value })
  }

  const handleEndDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ ...value, end: e.target.value })
  }

  return (
    <div className="mb-6 p-4 rounded border border-gray-200 bg-gray-50">
      <div className="mb-3">
        <label className="block text-sm font-semibold text-gray-900 mb-2">
          Report Period
        </label>
        <div className="flex flex-wrap gap-2">
          {[
            { type: 'today' as const, label: 'Today' },
            { type: 'week' as const, label: 'Last 7 days' },
            { type: 'month' as const, label: 'Last month' },
            { type: '3months' as const, label: 'Last 3 months' },
            { type: 'year' as const, label: 'Last year' },
            { type: 'all' as const, label: 'All time' },
            { type: 'custom' as const, label: 'Custom' },
          ].map(({ type, label }) => (
            <button
              key={type}
              onClick={() => (type === 'custom' ? null : handlePredefined(type))}
              className={`px-3 py-2 rounded text-sm font-medium transition-colors ${
                currentType === type
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
              }`}
              disabled={type === 'custom'}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
          <input
            type="date"
            value={value.start}
            onChange={handleStartDateChange}
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
          <input
            type="date"
            value={value.end}
            onChange={handleEndDateChange}
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
          />
        </div>
      </div>
    </div>
  )
}
