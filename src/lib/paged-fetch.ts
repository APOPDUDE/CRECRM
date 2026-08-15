/**
 * Fetch N pages with bounded concurrency and per-page retry.
 *
 * The book-sized queries page in parallel behind PostgREST's 1000-row cap. Firing
 * every page at once was its own denial of service: at ~34 pages (the book after the
 * 2026-08-15 gap imports) the database timed random pages out with 500s, and one
 * failed page threw away all the others and restarted the whole fetch. A small pool
 * keeps the wall-clock short without the herd, and a failed page retries alone.
 */
export async function fetchPages<T>(
  pageCount: number,
  fetchPage: (page: number) => Promise<T>,
  opts: { concurrency?: number; retries?: number } = {},
): Promise<T[]> {
  const { concurrency = 6, retries = 2 } = opts
  if (pageCount <= 0) return []
  const out: T[] = new Array(pageCount)
  let next = 0
  const attempt = async (page: number, tries: number): Promise<T> => {
    try {
      return await fetchPage(page)
    } catch (e) {
      if (tries >= retries) throw e
      await new Promise((r) => setTimeout(r, 500 * (tries + 1)))
      return attempt(page, tries + 1)
    }
  }
  const worker = async () => {
    while (next < pageCount) {
      const page = next++
      out[page] = await attempt(page, 0)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, pageCount) }, worker))
  return out
}
