import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PRINTER, sendToPrinter } from './printerClient'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('sendToPrinter', () => {
  it('posts the CPCL body to the configured host and port', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response())
    vi.stubGlobal('fetch', fetchMock)

    const result = await sendToPrinter('! 0 200 200 300 1\r\nPRINT\r\n')

    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      `http://${DEFAULT_PRINTER.host}:${DEFAULT_PRINTER.port}/`,
      expect.objectContaining({ method: 'POST', mode: 'no-cors', body: expect.any(String) }),
    )
  })

  it('sends to a target other than the default when given one', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response())
    vi.stubGlobal('fetch', fetchMock)

    await sendToPrinter('data', { host: '10.0.0.5', port: 9100 })

    expect(fetchMock).toHaveBeenCalledWith('http://10.0.0.5:9100/', expect.anything())
  })

  it('returns a failed result when the network request throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('Failed to fetch')),
    )

    const result = await sendToPrinter('data')
    expect(result.ok === false && result.error).toBe('Failed to fetch')
  })
})
