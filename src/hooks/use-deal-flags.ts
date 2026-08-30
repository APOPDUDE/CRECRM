import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Enums } from '@/lib/database.types'

export type DealFlag = {
  id: string
  created_at: string
  lease_vs_market_pct: number | null
  sale_vs_market_pct: number | null
  land_vs_market_pct: number | null
  property: {
    id: string
    address: string
    city: string | null
    state: string | null
    county: string | null
    property_type: Enums<'property_kind'> | null
    gross_sf: number | null
    land_acres: number | null
  } | null
}

/** Same explicit ceiling rationale as suggestions: own the cap, keep fan-out bounded. */
export const PENDING_DEAL_FLAGS_CAP = 300

// `!inner` so flags whose property has since gone off-market drop out of the feed.
const DEAL_FLAG_SELECT = `
  id, created_at, lease_vs_market_pct, sale_vs_market_pct, land_vs_market_pct,
  property:properties!deal_flags_property_id_fkey!inner(
    id, address, city, state, county, property_type, gross_sf, land_acres
  )
`

/** Pending deal flags on still-on-market properties, newest first. */
export function usePendingDealFlags() {
  return useQuery({
    queryKey: ['deal-flags', 'pending'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('deal_flags')
        .select(DEAL_FLAG_SELECT)
        .eq('status', 'pending')
        .eq('property.listing_status', 'on_market')
        .order('created_at', { ascending: false })
        .limit(PENDING_DEAL_FLAGS_CAP)
      if (error) throw error
      return data as unknown as DealFlag[]
    },
  })
}

/** The strongest discount on the flag, e.g. { pct: -32, kind: 'lease' }. */
export function bestDiscount(f: DealFlag): { pct: number; kind: 'lease' | 'sale' | 'land' } | null {
  const candidates: Array<{ pct: number | null; kind: 'lease' | 'sale' | 'land' }> = [
    { pct: f.lease_vs_market_pct, kind: 'lease' },
    { pct: f.sale_vs_market_pct, kind: 'sale' },
    { pct: f.land_vs_market_pct, kind: 'land' },
  ]
  let best: { pct: number; kind: 'lease' | 'sale' | 'land' } | null = null
  for (const c of candidates) {
    if (c.pct != null && (best == null || c.pct < best.pct)) best = { pct: c.pct, kind: c.kind }
  }
  return best
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['deal-flags'] })
}

async function removePendingOptimistically(
  qc: ReturnType<typeof useQueryClient>,
  ids: string[],
): Promise<{ prev: DealFlag[] | undefined }> {
  await qc.cancelQueries({ queryKey: ['deal-flags', 'pending'] })
  const prev = qc.getQueryData<DealFlag[]>(['deal-flags', 'pending'])
  qc.setQueryData<DealFlag[]>(['deal-flags', 'pending'], (old) =>
    old?.filter((f) => !ids.includes(f.id)),
  )
  return { prev }
}

/** Dismiss deal flags (kept as 'dismissed' so the property is never re-flagged). */
export function useDismissDealFlags() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase
        .from('deal_flags')
        .update({ status: 'dismissed' })
        .in('id', ids)
      if (error) throw error
    },
    onMutate: (ids) => removePendingOptimistically(qc, ids),
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['deal-flags', 'pending'], ctx.prev)
    },
    onSettled: () => invalidate(qc),
  })
}

/** Undo for Dismiss — flips the rows back to pending. */
export function useRestoreDealFlags() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase
        .from('deal_flags')
        .update({ status: 'pending' })
        .in('id', ids)
      if (error) throw error
    },
    onSuccess: () => invalidate(qc),
  })
}

/**
 * Queue a re-scan of the last two weeks of on-market imports. Since the v2 engine
 * (2026-08-29) this no longer flags synchronously: the RPC marks the target set stale
 * and schedules a background batch that re-values each listing through
 * estimate_property_value — flags land a few minutes later. Returns how many
 * listings were queued.
 */
export function useScanDealFlags() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('flag_deal_candidates', { p_days: 14 })
      if (error) throw error
      return (data as { queued?: number } | null)?.queued ?? 0
    },
    onSuccess: () => invalidate(qc),
  })
}
