/**
 * The one-click outreach action. There is no reliable deep link to a seller's
 * Messenger thread, so the flow is: copy the personalized message to the
 * clipboard, open the listing's Facebook URL (which contains the "Message
 * seller" box) in a new tab, and let the human paste + send. Nothing here
 * sends anything — that stays human-in-the-loop by design.
 */

/** Copy text, tolerating the clipboard API being unavailable (returns success). */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

/** Open a URL in a new tab without leaking the referrer to Facebook. */
export function openInNewTab(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer')
}
