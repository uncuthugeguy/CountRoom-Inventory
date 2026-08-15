import { useRef } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { memoryStorage } from '../../test/memoryStorage'
import { useSettings } from '../useSettings'
import type { CameraControls, StartCameraScan } from '../../scanner/cameraScanner'
import { QuickCodesScreen } from './QuickCodesScreen'

/** Renders the real `useSettings` hook backed by an isolated in-memory
 * storage per test, so these tests exercise the same add/search/delete
 * wiring the app actually uses rather than a hand-rolled settings stub. */
function Harness({ startCamera }: { startCamera?: StartCameraScan }) {
  const storageRef = useRef(memoryStorage())
  const settings = useSettings(storageRef.current)
  return <QuickCodesScreen settings={settings} startCamera={startCamera} />
}

/** A fake scan session whose decode callback the test drives by hand —
 * mirrors the one in `CameraScanner.test.tsx`. */
function fakeScanner() {
  const stop = vi.fn()
  let emit: ((text: string) => void) | null = null
  const start: StartCameraScan = async (_video, onResult) => {
    emit = onResult
    return { stop } satisfies CameraControls
  }
  return { start, decode: (text: string) => emit?.(text) }
}

const addCode = async (
  user: ReturnType<typeof userEvent.setup>,
  { category, name, value, note, format }: { category?: string; name: string; value: string; note?: string; format?: 'qr' | 'code128' },
) => {
  await user.click(screen.getByRole('button', { name: /add a code/i }))
  const dialog = screen.getByRole('dialog', { name: /add a code/i })
  if (category) {
    await user.clear(within(dialog).getByLabelText(/category/i))
    await user.type(within(dialog).getByLabelText(/category/i), category)
  }
  await user.type(within(dialog).getByLabelText(/^name$/i), name)
  if (format) await user.selectOptions(within(dialog).getByLabelText(/code type/i), format)
  await user.type(within(dialog).getByLabelText(/code value/i), value)
  if (note) await user.type(within(dialog).getByLabelText(/note/i), note)
  await user.click(within(dialog).getByRole('button', { name: /^add code$/i }))
}

describe('QuickCodesScreen', () => {
  it('shows an empty state with no codes saved', () => {
    render(<Harness />)
    expect(screen.getByText(/no codes saved yet/i)).toBeInTheDocument()
  })

  it('adds a code and lists it under its category', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await addCode(user, { category: 'Printer codes', name: 'Restore defaults', value: 'ZEBRA-RESTORE' })

    expect(screen.getByText('Printer codes', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('Restore defaults')).toBeInTheDocument()
    expect(screen.queryByText(/no codes saved yet/i)).toBeNull()
  })

  it('groups codes under separate category headings', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await addCode(user, { category: 'Printer codes', name: 'Restore defaults', value: 'A' })
    await addCode(user, { category: 'Wi-Fi codes', name: 'Guest Wi-Fi', value: 'B' })

    expect(screen.getByRole('heading', { name: /printer codes/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /wi-fi codes/i })).toBeInTheDocument()
  })

  it('filters codes by the search box across name, category and note', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await addCode(user, { category: 'Printer codes', name: 'Restore defaults', value: 'A' })
    await addCode(user, { category: 'Wi-Fi codes', name: 'Guest Wi-Fi', value: 'B', note: 'Front desk only' })

    await user.type(screen.getByLabelText(/search/i), 'guest')

    expect(screen.getByText('Guest Wi-Fi')).toBeInTheDocument()
    expect(screen.queryByText('Restore defaults')).toBeNull()
  })

  it('shows a "no matches" message when the search matches nothing', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await addCode(user, { name: 'Restore defaults', value: 'A' })
    await user.type(screen.getByLabelText(/search/i), 'nonexistent')

    expect(screen.getByText(/no codes match/i)).toBeInTheDocument()
  })

  it('opens a scannable code on "Scan"', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await addCode(user, { name: 'Restore defaults', value: 'ZEBRA-RESTORE' })
    await user.click(screen.getByRole('button', { name: /^scan$/i }))

    const dialog = screen.getByRole('dialog', { name: /restore defaults/i })
    expect(within(dialog).getByRole('img', { name: /scannable code/i })).toBeInTheDocument()
  })

  it('defaults a new code to QR, and saves + redisplays it correctly when Code 128 is picked instead', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await addCode(user, { name: 'Printer config', value: 'ZEBRA-CFG-9', format: 'code128' })
    await user.click(screen.getByRole('button', { name: /^scan$/i }))

    const dialog = screen.getByRole('dialog', { name: /printer config/i })
    // A real code is rendered (not the "couldn't generate" fallback), proving
    // the picked format actually made it through to the saved code and back
    // out to `ScanCode` rather than being silently coerced to QR.
    expect(within(dialog).getByRole('img', { name: /scannable code/i })).toBeInTheDocument()
    expect(within(dialog).queryByText(/couldn't generate/i)).toBeNull()
  })

  it('fills the code value from a camera scan instead of manual typing or pasting', async () => {
    const user = userEvent.setup()
    const scanner = fakeScanner()
    render(<Harness startCamera={scanner.start} />)

    await user.click(screen.getByRole('button', { name: /add a code/i }))
    const dialog = screen.getByRole('dialog', { name: /add a code/i })

    await user.type(within(dialog).getByLabelText(/^name$/i), 'Restore defaults')
    await user.click(within(dialog).getByRole('button', { name: /scan with camera/i }))
    await user.click(within(dialog).getByRole('button', { name: /start camera/i }))

    scanner.decode('ZEBRA-RESTORE')

    await waitFor(() => expect(within(dialog).getByLabelText(/code value/i)).toHaveValue('ZEBRA-RESTORE'))
    // The camera view collapses again once it has what it needs.
    expect(within(dialog).queryByRole('button', { name: /stop camera/i })).toBeNull()

    await user.click(within(dialog).getByRole('button', { name: /^add code$/i }))
    expect(screen.getByText('Restore defaults')).toBeInTheDocument()
  })

  it('deletes a code', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await addCode(user, { name: 'Restore defaults', value: 'A' })
    await user.click(screen.getByRole('button', { name: /delete restore defaults/i }))

    expect(screen.queryByText('Restore defaults')).toBeNull()
    expect(screen.getByText(/no codes saved yet/i)).toBeInTheDocument()
  })

  it('edits a code and reflects the change in the list', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await addCode(user, { name: 'Battery', value: 'OLD' })
    await user.click(screen.getByRole('button', { name: /^edit$/i }))

    const dialog = screen.getByRole('dialog', { name: /edit/i })
    const nameField = within(dialog).getByLabelText(/^name$/i)
    await user.clear(nameField)
    await user.type(nameField, 'Battery status')
    await user.click(within(dialog).getByRole('button', { name: /save changes/i }))

    expect(screen.getByText('Battery status')).toBeInTheDocument()
    expect(screen.queryByText('Battery')).toBeNull()
  })
})
