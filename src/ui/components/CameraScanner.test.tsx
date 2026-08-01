import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { CameraControls, StartCameraScan } from '../../scanner/cameraScanner'
import { CameraScanner } from './CameraScanner'

/** A fake scan session whose decode callback the test drives by hand. */
function fakeScanner() {
  const stop = vi.fn()
  let emit: ((text: string) => void) | null = null
  const start: StartCameraScan = async (_video, onResult) => {
    emit = onResult
    return { stop } satisfies CameraControls
  }
  return { start, stop, decode: (text: string) => emit?.(text) }
}

describe('CameraScanner', () => {
  it('stays idle until the user opts in, so the camera is never opened unasked', () => {
    const { start } = fakeScanner()
    const spy = vi.fn(start)
    render(<CameraScanner onDecode={vi.fn()} start={spy} />)

    expect(screen.getByRole('button', { name: /start camera/i })).toBeInTheDocument()
    expect(document.querySelector('video')).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it('starts a scan against the rendered video element and reports decoded barcodes', async () => {
    const user = userEvent.setup()
    const scanner = fakeScanner()
    const started = vi.fn(scanner.start)
    const onDecode = vi.fn()
    render(<CameraScanner onDecode={onDecode} start={started} />)

    await user.click(screen.getByRole('button', { name: /start camera/i }))

    await waitFor(() => expect(started).toHaveBeenCalledTimes(1))
    expect(started.mock.calls[0][0]).toBeInstanceOf(HTMLVideoElement)
    expect(started.mock.calls[0][0]).toBe(document.querySelector('video'))

    scanner.decode('5012345678900')
    expect(onDecode).toHaveBeenCalledWith('5012345678900')
  })

  it('stops the scan and tears the preview down when the user stops it', async () => {
    const user = userEvent.setup()
    const scanner = fakeScanner()
    render(<CameraScanner onDecode={vi.fn()} start={scanner.start} />)

    await user.click(screen.getByRole('button', { name: /start camera/i }))
    await screen.findByRole('button', { name: /stop camera/i })

    await user.click(screen.getByRole('button', { name: /stop camera/i }))

    expect(scanner.stop).toHaveBeenCalledTimes(1)
    expect(document.querySelector('video')).toBeNull()
  })

  it('stops the scan when the screen is left, so the camera light goes out', async () => {
    const user = userEvent.setup()
    const scanner = fakeScanner()
    const { unmount } = render(<CameraScanner onDecode={vi.fn()} start={scanner.start} />)

    await user.click(screen.getByRole('button', { name: /start camera/i }))
    await screen.findByRole('button', { name: /stop camera/i })

    unmount()

    await waitFor(() => expect(scanner.stop).toHaveBeenCalledTimes(1))
  })

  it('surfaces a denied or unavailable camera as a readable message', async () => {
    const user = userEvent.setup()
    const start: StartCameraScan = () => Promise.reject(new Error('Permission denied'))
    render(<CameraScanner onDecode={vi.fn()} start={start} />)

    await user.click(screen.getByRole('button', { name: /start camera/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Permission denied')
    expect(screen.getByRole('button', { name: /start camera/i })).toBeInTheDocument()
  })
})
