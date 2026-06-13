// Thin client for the n8n automation webhooks. The CRM calls these to scrape a
// pasted LoopNet/Crexi link or to search the market for a tenant; n8n writes the
// results straight into Supabase (via the import_scraped_listings RPC) and the
// app reacts to the new rows. Base URL is configured per environment; when unset
// the automation features hide themselves.
const base = (import.meta.env.VITE_N8N_WEBHOOK_BASE as string | undefined)?.replace(/\/$/, '')

/** Whether the automation webhooks are configured for this environment. */
export function automationEnabled(): boolean {
  return !!base
}

export const N8N_PATHS = {
  scrapeUrl: 'cre-scrape-url',
  searchTenant: 'cre-search-tenant',
} as const

/** POST JSON to an n8n webhook and return its JSON response (throws on failure). */
export async function callN8nWebhook<T = unknown>(
  path: string,
  payload: unknown,
  opts?: { timeoutMs?: number },
): Promise<T> {
  if (!base) throw new Error('Automation is not configured for this environment.')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 120_000)
  try {
    const res = await fetch(`${base}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    const text = await res.text()
    let body: unknown = undefined
    try {
      body = text ? JSON.parse(text) : undefined
    } catch {
      // non-JSON response
    }
    if (!res.ok) {
      const msg =
        (body as { message?: string } | undefined)?.message ?? `Request failed (${res.status})`
      throw new Error(msg)
    }
    return body as T
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('The automation is taking longer than expected — try again in a moment.')
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}
