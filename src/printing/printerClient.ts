import type { Result } from '../domain/types'

export interface PrinterTarget {
  host: string
  port: number
}

/** The Zebra QLn220 this app prints to, reachable over the local WiFi network. */
export const DEFAULT_PRINTER: PrinterTarget = { host: '192.168.50.82', port: 9100 }

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
  try {
    await fetch(`http://${target.host}:${target.port}/`, {
      method: 'POST',
      mode: 'no-cors',
      body: cpcl,
    })
    // `no-cors` hides the response, so this cannot actually confirm the
    // printer accepted the job — only that the request was sent.
    return { ok: true, value: true }
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) }
  }
}
