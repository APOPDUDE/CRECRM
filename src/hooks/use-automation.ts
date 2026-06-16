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
 * Scrape a pasted LoopNet/Crexi link via the n8n webhook. When a tenantRepId is
 * given the scraped property is added to that tenant's board as an 'inquiring' match.
 */
export function useScrapePropertyByUrl() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      url,
      urls,
      tenantRepId,
    }: {
      url?: string
      urls?: string[]
      tenantRepId?: string | null
    }) => {
      const res = await callN8nWebhook<ScrapeResult>(
        N8N_PATHS.scrapeUrl,
        { url, urls, tenant_rep_id: tenantRepId ?? undefined },
        { timeoutMs: 180_000 },
      )
      if (res?.ok === false) throw new Error(res.message || 'Could not scrape those listings.')
      if (!res?.scraped) throw new Error('No listings were found at those links.')
      return res
    },
    onSuccess: () => invalidateAutomationViews(qc),
  })
}

/**
 * Search the market for a tenant's requirements via the n8n webhook. Matching
 * listings land on the tenant's board as 'inquiring' matches.
 */
export function useSearchListingsForTenant() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      tenantRepId,
      city,
      state,
    }: {
      tenantRepId: string
      city?: string
      state?: string
    }) => {
      const res = await callN8nWebhook<SearchResult>(
        N8N_PATHS.searchTenant,
        { tenant_rep_id: tenantRepId, city, state },
        { timeoutMs: 120_000 },
      )
      if (res?.ok === false) {
        throw new Error(
          res.error === 'no_location'
            ? 'Add a target area (city) to this tenant first, or include a city.'
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
