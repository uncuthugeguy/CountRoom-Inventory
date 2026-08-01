import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CAMERA_UNSUPPORTED, startCameraScan } from './cameraScanner'

const { decodeFromVideoDevice } = vi.hoisted(() => ({
  decodeFromVideoDevice: vi.fn(),
}))

vi.mock('@zxing/browser', () => ({
  BrowserMultiFormatReader: class {
    decodeFromVideoDevice = decodeFromVideoDevice
  },
}))

const setMediaDevices = (value: unknown) => {
  Object.defineProperty(navigator, 'mediaDevices', { value, configurable: true })
}

/** Stands in for a zxing Result; only getText is used by the adapter. */
const result = (text: string) => ({ getText: () => text })

beforeEach(() => {
  decodeFromVideoDevice.mockReset()
  setMediaDevices({ getUserMedia: vi.fn() })
})

afterEach(() => {
  setMediaDevices(undefined)
})

describe('startCameraScan', () => {
  it('reports an unsupported browser instead of throwing a cryptic error', async () => {
    setMediaDevices(undefined)
    await expect(startCameraScan(document.createElement('video'), vi.fn())).rejects.toThrow(
      CAMERA_UNSUPPORTED,
    )
  })

  it('reports an unsupported browser when getUserMedia is missing', async () => {
    setMediaDevices({})
    await expect(startCameraScan(document.createElement('video'), vi.fn())).rejects.toThrow(
      CAMERA_UNSUPPORTED,
    )
  })

  it('decodes into the supplied video element and forwards the barcode text', async () => {
    const stop = vi.fn()
    decodeFromVideoDevice.mockResolvedValue({ stop })
    const video = document.createElement('video')
    const onResult = vi.fn()

    await startCameraScan(video, onResult)

    expect(decodeFromVideoDevice).toHaveBeenCalledTimes(1)
    const [deviceId, previewElement, callback] = decodeFromVideoDevice.mock.calls[0]
    expect(deviceId).toBeUndefined()
    expect(previewElement).toBe(video)

    callback(result('5012345678900'), undefined, { stop })
    expect(onResult).toHaveBeenCalledWith('5012345678900')
  })

  it('ignores the per-frame not-found errors a live scan produces', async () => {
    decodeFromVideoDevice.mockResolvedValue({ stop: vi.fn() })
    const onResult = vi.fn()
    await startCameraScan(document.createElement('video'), onResult)

    const callback = decodeFromVideoDevice.mock.calls[0][2]
    callback(undefined, new Error('NotFoundException'), { stop: vi.fn() })
    callback(null, undefined, { stop: vi.fn() })

    expect(onResult).not.toHaveBeenCalled()
  })

  it('returns controls that stop the underlying scan', async () => {
    const stop = vi.fn()
    decodeFromVideoDevice.mockResolvedValue({ stop })

    const controls = await startCameraScan(document.createElement('video'), vi.fn())
    controls.stop()

    expect(stop).toHaveBeenCalledTimes(1)
  })
})
