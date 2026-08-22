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
    <div className="panel">
      <div className="field">
        <span className="label-like">Report period</span>
        <div className="channel-picker">
          {[
            { type: 'today' as const, label: 'Today' },
            { type: 'week' as const, label: 'Last 7 days' },
            { type: 'month' as const, label: 'Last month' },
            { type: '3months' as const, label: 'Last 3 months' },
            { type: 'year' as const, label: 'Last year' },
            { type: 'all' as const, label: 'All time' },
          ].map(({ type, label }) => (
            <button
              key={type}
              type="button"
              onClick={() => handlePredefined(type)}
              className={`button chip-button ${currentType === type ? 'chip-button-active' : ''}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="report-range-start">Start date</label>
          <input id="report-range-start" type="date" value={value.start} onChange={handleStartDateChange} />
        </div>
        <div className="field">
          <label htmlFor="report-range-end">End date</label>
          <input id="report-range-end" type="date" value={value.end} onChange={handleEndDateChange} />
        </div>
      </div>
    </div>
  )
}
