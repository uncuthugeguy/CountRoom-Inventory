import type { Result } from '../domain/types'

export interface PrinterTarget {
  host: string
  port: number
}

/** The Zebra QLn220 this app prints to, reachable over the local WiFi network. */
export const DEFAULT_PRINTER: PrinterTarget = { host: '192.168.50.82', port: 9100 }

/**
 * How long to wait for the printer before giving up. A plain fetch to a
 * local IP that's switched off, off the network, or just unreachable from
 * wherever the browser currently is (e.g. printing from the online version
 * away from the shop's WiFi) doesn't necessarily fail fast — some networks
 * silently drop the connection attempt instead of refusing it, which can
 * leave the request pending for minutes at the OS level. Without a bound on
 * that, "Printing…" stays stuck until the page is reloaded, which is worse
 * than just failing with a clear message.
 */
const PRINT_TIMEOUT_MS = 8000

/**
 * Sends a CPCL job to the printer's raw network port.
 *
 * Caveat: browsers have no raw TCP socket API, so this is a best-effort plain
 * HTTP POST to that host:port rather than a genuine raw-socket write. Some
 * network print servers accept and print the body regardless of the HTTP
 * preamble; many do not. If labels do not come out, the reliable fixes are
 * either Zebra's "Browser Print" utility (a local agent the browser can talk
 * to over plain HTTP, which then relays to the printer over a real socket)
 * or a small local relay service that opens the raw socket on this app's
 * behalf — both require something installed alongside the browser, since the
 * browser sandbox itself cannot open one.
 */
export async function sendToPrinter(
  cpcl: string,
  target: PrinterTarget = DEFAULT_PRINTER,
): Promise<Result<true>> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PRINT_TIMEOUT_MS)
  try {
    await fetch(`http://${target.host}:${target.port}/`, {
      method: 'POST',
      mode: 'no-cors',
      body: cpcl,
      signal: controller.signal,
    })
    // `no-cors` hides the response, so this cannot actually confirm the
    // printer accepted the job — only that the request was sent.
    return { ok: true, value: true }
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') {
      return {
        ok: false,
        error: `Timed out waiting for the printer at ${target.host}:${target.port} — check it's switched on and on the same network.`,
      }
    }
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) }
  } finally {
    clearTimeout(timeout)
  }
}
