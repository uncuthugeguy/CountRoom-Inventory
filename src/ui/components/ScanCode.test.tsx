import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ScanCode } from './ScanCode'

describe('ScanCode', () => {
  it('renders a QR code by default', () => {
    render(<ScanCode value="https://example.com/restore" />)
    const img = screen.getByRole('img', { name: /scannable code/i })
    expect(img.tagName.toLowerCase()).toBe('svg')
    // A QR code's viewBox is always square.
    const [, , w, h] = img.getAttribute('viewBox')!.split(' ')
    expect(w).toBe(h)
  })

  it('renders a Code 128 barcode when format is "code128"', () => {
    render(<ScanCode value="ZEBRA-RESTORE" format="code128" />)
    const img = screen.getByRole('img', { name: /scannable code/i })
    expect(img.tagName.toLowerCase()).toBe('svg')
    // A barcode's viewBox is much wider than it is tall, unlike a QR code.
    const [, , w, h] = img.getAttribute('viewBox')!.split(' ').map(Number)
    expect(w).toBeGreaterThan(h * 3)
  })

  it('falls back to showing the raw value when a Code 128 value has no representation in Code Set B', () => {
    render(<ScanCode value="café" format="code128" />)
    expect(screen.getByText(/couldn't generate a scannable code/i)).toBeInTheDocument()
    expect(screen.getByText('café')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /scannable code/i })).toBeNull()
  })

  it('falls back for an empty value in either format', () => {
    const { rerender } = render(<ScanCode value="" format="qr" />)
    expect(screen.getByText(/couldn't generate a scannable code/i)).toBeInTheDocument()

    rerender(<ScanCode value="" format="code128" />)
    expect(screen.getByText(/couldn't generate a scannable code/i)).toBeInTheDocument()
  })
})
