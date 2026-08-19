import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatRelativeTime } from './format'

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-16T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows "just now" for anything under 5 seconds old', () => {
    expect(formatRelativeTime('2026-08-16T11:59:58.000Z')).toBe('just now')
  })

  it('shows seconds for under a minute', () => {
    expect(formatRelativeTime('2026-08-16T11:59:30.000Z')).toBe('30s ago')
  })

  it('shows minutes for under an hour', () => {
    expect(formatRelativeTime('2026-08-16T11:45:00.000Z')).toBe('15m ago')
  })

  it('shows hours for under a day', () => {
    expect(formatRelativeTime('2026-08-16T10:00:00.000Z')).toBe('2h ago')
  })

  it('shows days for under a week', () => {
    expect(formatRelativeTime('2026-08-14T12:00:00.000Z')).toBe('2d ago')
  })

  it('falls back to the full date/time at a week or older', () => {
    const result = formatRelativeTime('2026-08-01T12:00:00.000Z')
    expect(result).not.toMatch(/ago$/)
  })

  it('treats a timestamp from the future as "just now" rather than negative', () => {
    expect(formatRelativeTime('2026-08-16T12:05:00.000Z')).toBe('just now')
  })

  it('returns the raw input for an unparseable timestamp', () => {
    expect(formatRelativeTime('not-a-date')).toBe('not-a-date')
  })
})
