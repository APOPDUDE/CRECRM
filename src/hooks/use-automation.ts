import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { callN8nWebhook, N8N_PATHS } from '@/lib/n8n'

type ImportSummary = {
  properties_upserted?: number
  matches_created?: number
  asking_comps_upserted?: number
}

export type ScrapeResult = {
  ok?: boolean
  scraped?: number
  message?: string
  result?: ImportSummary
}

export type SearchResult = {
  ok?: boolean
  found?: number
  searched?: string
  error?: string
  message?: string
  result?: ImportSummary
}

function invalidateAutomationViews(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['matches'] })
  qc.invalidateQueries({ queryKey: ['properties'] })
  qc.invalidateQueries({ queryKey: ['tenant_reps'] })
}

/**
 * Scrape a pasted LoopNet or Crexi link via the n8n webhook (separate workflows /
 * actors per source). When a tenantRepId is given the scraped property is added to
 * that tenant's board as an 'inquiring' match.
 */
export function useScrapePropertyByUrl() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      url,
      urls,
      tenantRepId,
      source = 'loopnet',
    }: {
      url?: string
      urls?: string[]
      tenantRepId?: string | null
      source?: 'loopnet' | 'crexi'
    }) => {
      // The scraper resolves a listing from the path id, so strip query strings
      // and fragments — this drops LoopNet/Crexi tracking + "recommId" recommendation
      // params that can otherwise point at the wrong listing.
      const clean = (u: string) => u.split('#')[0].split('?')[0]
      const path = source === 'crexi' ? N8N_PATHS.scrapeCrexi : N8N_PATHS.scrapeUrl
      const payload = {
        url: url ? clean(url) : undefined,
        urls: urls?.map(clean),
        tenant_rep_id: tenantRepId ?? undefined,
      }
      const run = () => callN8nWebhook<ScrapeResult>(path, payload, { timeoutMs: 180_000 })

      let res = await run()
      if (res?.ok === false) throw new Error(res.message || 'Could not scrape those listings.')
      // The LoopNet/Crexi actors occasionally return nothing on a transient
      // anti-bot block; a single re-run almost always succeeds.
      if (!res?.scraped) {
        res = await run()
        if (res?.ok === false) throw new Error(res.message || 'Could not scrape those listings.')
      }
      if (!res?.scraped) {
        throw new Error(
          'No listing found at that link — make sure it’s the listing page URL (not a search or “recommended” link).',
        )
      }
      return res
    },
    onSuccess: () => invalidateAutomationViews(qc),
  })
}

/**
 * Kick off a market search for a tenant (LoopNet + Crexi via the kazkn actor). Runs
 * async server-side (responds immediately, scrapes in the background), so callers
 * should refresh the board after a delay. `criteria` carries the editable filters
 * (cities, property_types, building_sf_*, land_acres_*, cap_rate_*, price_*, keywords).
 */
export function useSearchListingsForTenant() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      tenantRepId,
      criteria,
    }: {
      tenantRepId: string
      criteria?: Record<string, unknown>
    }) => {
      const res = await callN8nWebhook<SearchResult>(
        N8N_PATHS.searchTenant,
        { tenant_rep_id: tenantRepId, ...(criteria || {}) },
        { timeoutMs: 60_000 },
      )
      if (res?.ok === false) {
        throw new Error(
          res.error === 'no_location'
            ? 'Add a target market (city) for this tenant, or enter one.'
            : res.message || 'The market search failed.',
        )
      }
      return res
    },
    onSuccess: () => invalidateAutomationViews(qc),
  })
}

/** Clear the "new" flag for a client's pursuits once its board has been viewed. */
export function useClearFlaggedNew() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (clientId: string) => {
      const { error } = await supabase
        .from('pursuits')
        .update({ flagged_new: false })
        .eq('client_id', clientId)
        .eq('flagged_new', true)
      if (error) throw error
    },
    // refresh the tenant-rep list (new-match dot) but leave the open board untouched
    // so the tag stays visible while the broker is looking at it.
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenant_reps'] }),
  })
}
