import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Renders `children` straight onto `<body>`, as a sibling of the app's own
 * root element rather than nested deep inside it.
 *
 * This is what makes printing a single receipt/report actually print one
 * page. The old approach nested the printable block inside the app tree and
 * used `visibility: hidden` + `position: absolute` in `@media print` to
 * isolate it — but `visibility: hidden` still reserves layout space, so the
 * browser paginated against the full (very tall) height of the entire app,
 * printing the one visible block on page one and several blank pages after
 * it. Portalling the printable content out to `<body>` means `@media print`
 * can instead hide the whole app with a plain `display: none` (removing it
 * from layout entirely) while the printable block prints normally, sized to
 * its own content — see the `@media print` rule in styles.css.
 */
export function PrintPortal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body)
}
