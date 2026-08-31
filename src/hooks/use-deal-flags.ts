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
    // For classifying what a LAND flag is actually FOR (see landUse). zoning_type is a
    // normalized enum (industrial/retail/office/multifamily/residential/agricultural/
    // mixed_use/planned_development/other); the rest are the keyword fallback.
    zoning_type: string | null
    property_sub_types: string[] | null
    zoning_description: string | null
    title: string | null
    description: string | null
    specs: string | null
  } | null
}

/** Same explicit ceiling rationale as suggestions: own the cap, keep fan-out bounded. */
export const PENDING_DEAL_FLAGS_CAP = 300

// `!inner` so flags whose property has since gone off-market drop out of the feed.
const DEAL_FLAG_SELECT = `
  id, created_at, lease_vs_market_pct, sale_vs_market_pct, land_vs_market_pct,
  property:properties!deal_flags_property_id_fkey!inner(
    id, address, city, state, county, property_type, gross_sf, land_acres,
    zoning_type, property_sub_types, zoning_description, title, description, specs
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

/**
 * What a LAND flag is actually FOR — so a broker scanning for industrial deals can skip
 * the retail/residential/multifamily land LoopNet mixes in, without us dropping it from
 * the book. `nonIndustrial` = we're confident it isn't an industrial play (drives the
 * default-hide); ambiguous cases (generic commercial, planned dev, unknown) stay visible
 * so a real industrial deal is never hidden. Returns null for anything that isn't land.
 *
 * zoning_type (a normalized enum, populated on most on-market land listings) is
 * authoritative; where it's null we rescue from the listing's own words.
 */
export function landUse(
  p: NonNullable<DealFlag['property']>,
): { label: string; nonIndustrial: boolean } | null {
  if (p.property_type !== 'land') return null

  const byZoning: Record<string, { label: string; nonIndustrial: boolean }> = {
    industrial: { label: 'Industrial', nonIndustrial: false },
    retail: { label: 'Retail', nonIndustrial: true },
    office: { label: 'Office', nonIndustrial: true },
    multifamily: { label: 'Multifamily', nonIndustrial: true },
    residential: { label: 'Residential', nonIndustrial: true },
    agricultural: { label: 'Agricultural', nonIndustrial: true },
    mixed_use: { label: 'Mixed-use', nonIndustrial: true },
  }
  const z = p.zoning_type?.toLowerCase() ?? null
  if (z && byZoning[z]) return byZoning[z]

  // zoning_type null / planned_development / other → read the listing's own words.
  const hay = [p.title, p.description, p.zoning_description, p.specs, ...(p.property_sub_types ?? [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  if (/industrial|warehouse|distribution|manufactur|\bflex\b|logistics|truck terminal|laydown|outdoor storage|\bios\b|self.?storage/.test(hay))
    return { label: 'Industrial', nonIndustrial: false }
  if (/hotel|hospitality|motel|\bresort\b/.test(hay)) return { label: 'Hospitality', nonIndustrial: true }
  if (/multi.?family|multifamily|apartment|multi.?unit/.test(hay)) return { label: 'Multifamily', nonIndustrial: true }
  if (/\boffice\b/.test(hay)) return { label: 'Office', nonIndustrial: true }
  if (/retail|storefront|shopping|outparcel|\bpad\b|restaurant|strip center|drive.?thru/.test(hay))
    return { label: 'Retail', nonIndustrial: true }
  if (/residential|single.?family|\bsfr\b|homesite|dream home|subdivision/.test(hay))
    return { label: 'Residential', nonIndustrial: true }
  if (/agricultur|\bfarm\b|\bgrove\b|pasture/.test(hay)) return { label: 'Agricultural', nonIndustrial: true }

  // Ambiguous — keep visible rather than risk hiding an industrial play.
  if (z === 'planned_development') return { label: 'Planned dev', nonIndustrial: false }
  if ((p.property_sub_types ?? []).some((s) => /commercial/i.test(s)))
    return { label: 'Commercial', nonIndustrial: false }
  if ((p.property_sub_types ?? []).some((s) => /residential/i.test(s)))
    return { label: 'Residential', nonIndustrial: true }
  return { label: 'Use unknown', nonIndustrial: false }
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
