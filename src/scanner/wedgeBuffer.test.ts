import { describe, expect, it } from 'vitest'
import { createWedgeBuffer } from './wedgeBuffer'

describe('createWedgeBuffer', () => {
  it('emits the accumulated barcode when Enter arrives', () => {
    const buffer = createWedgeBuffer()
    for (const key of '5012345678900') expect(buffer.push(key, 0)).toBeNull()
    expect(buffer.push('Enter', 0)).toBe('5012345678900')
  })

  it('clears itself after emitting so the next scan starts fresh', () => {
    const buffer = createWedgeBuffer()
    for (const key of 'ABC') buffer.push(key, 0)
    buffer.push('Enter', 0)
    for (const key of 'XYZ') buffer.push(key, 10)
    expect(buffer.push('Enter', 10)).toBe('XYZ')
  })

  it('ignores non-character keys such as Shift and Tab', () => {
    const buffer = createWedgeBuffer()
    buffer.push('Shift', 0)
    for (const key of 'AB') buffer.push(key, 0)
    buffer.push('Tab', 0)
    buffer.push('C', 0)
    expect(buffer.push('Enter', 0)).toBe('ABC')
  })

  it('discards input slower than the inter-key timeout — a human typing, not a scanner', () => {
    const buffer = createWedgeBuffer({ interKeyMs: 50 })
    buffer.push('A', 0)
    buffer.push('B', 20)
    // 500ms gap: treat as a fresh keystroke, dropping what came before.
    buffer.push('C', 520)
    buffer.push('D', 530)
    expect(buffer.push('Enter', 540)).toBe('CD')
  })

  it('discards a scan shorter than the minimum length', () => {
    const buffer = createWedgeBuffer({ minLength: 4 })
    for (const key of 'ABC') buffer.push(key, 0)
    expect(buffer.push('Enter', 0)).toBeNull()
  })

  it('emits a scan at exactly the minimum length', () => {
    const buffer = createWedgeBuffer({ minLength: 4 })
    for (const key of 'ABCD') buffer.push(key, 0)
    expect(buffer.push('Enter', 0)).toBe('ABCD')
  })

  it('emits nothing for a bare Enter', () => {
    expect(createWedgeBuffer().push('Enter', 0)).toBeNull()
  })

  it('can be reset explicitly', () => {
    const buffer = createWedgeBuffer()
    for (const key of 'ABCDEF') buffer.push(key, 0)
    buffer.reset()
    expect(buffer.push('Enter', 0)).toBeNull()
  })
})
