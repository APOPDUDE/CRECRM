import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { APPROVED_STATUSES } from '@/lib/deal-radar'
import type { Enums, Tables } from '@/lib/database.types'

export type DealRadarStatus = Enums<'deal_radar_status'>
export type DealRadarType = Enums<'deal_radar_type'>
export type DealRadarSource = Enums<'deal_radar_source'>
export type DealRadarIntent = Enums<'deal_radar_intent'>
export type DealRadarRow = Tables<'deal_radar'>

export interface DealRadarFilters {
  /** 'open' = untriaged new listings; 'approved_bucket' = approved + converted. */
  status?: DealRadarStatus | 'open' | 'approved_bucket' | null
  market?: string | null
  location?: string | null
  type?: DealRadarType | null
  intent?: DealRadarIntent | null
  source?: DealRadarSource | null
  minPrice?: number | null
  maxPrice?: number | null
  minSqft?: number | null
}

// The untriaged working set. Approve/decline moves a listing out of it.
const OPEN_STATUSES: DealRadarStatus[] = ['new']

/**
 * The radar feed, newest first. `status: 'open'` = the untriaged new set;
 * 'approved_bucket' = approved + converted; a concrete status pins one; null = all.
 */
export function useDealRadar(filters: DealRadarFilters = { status: 'open' }) {
  return useQuery({
    queryKey: ['deal_radar', filters],
    queryFn: async (): Promise<DealRadarRow[]> => {
      let q = supabase.from('deal_radar').select('*').order('found_at', { ascending: false }).limit(500)
      if (filters.status === 'open') q = q.in('status', OPEN_STATUSES)
      else if (filters.status === 'approved_bucket') q = q.in('status', APPROVED_STATUSES)
      else if (filters.status) q = q.eq('status', filters.status)
      if (filters.market) q = q.eq('market', filters.market)
      if (filters.location) q = q.eq('location_text', filters.location)
      if (filters.type) q = q.eq('listing_type', filters.type)
      if (filters.intent) q = q.eq('listing_intent', filters.intent)
      if (filters.source) q = q.eq('source', filters.source)
      if (filters.minPrice != null) q = q.gte('price', filters.minPrice)
      if (filters.maxPrice != null) q = q.lte('price', filters.maxPrice)
      if (filters.minSqft != null) q = q.gte('size_sqft', filters.minSqft)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })
}

/** Counts for the header: new-today total + a per-market tally of new rows. */
export function useDealRadarStats() {
  return useQuery({
    queryKey: ['deal_radar', 'stats'],
    queryFn: async () => {
      const since = new Date()
      since.setHours(0, 0, 0, 0)
      const { data, error } = await supabase
        .from('deal_radar')
        .select('market, found_at, status')
        .eq('status', 'new')
      if (error) throw error
      const byMarket = new Map<string, number>()
      let newToday = 0
      for (const r of data ?? []) {
        byMarket.set(r.market, (byMarket.get(r.market) ?? 0) + 1)
        if (r.found_at && new Date(r.found_at) >= since) newToday += 1
      }
      return { newToday, byMarket, totalNew: data?.length ?? 0 }
    },
  })
}

/** The most recent worker cycle — powers the "last poll / errors" strip. */
export function useDealRadarLatestRun() {
  return useQuery({
    queryKey: ['deal_radar', 'latest_run'],
    queryFn: async (): Promise<Tables<'deal_radar_runs'> | null> => {
      const { data, error } = await supabase
        .from('deal_radar_runs')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return data
    },
    refetchInterval: 5 * 60_000,
  })
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['deal_radar'] })
}

/** Move a deal's status (the human keeps the CRM current — replies aren't auto-captured). */
export function useUpdateDealRadarStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: DealRadarStatus }) => {
      const { error } = await supabase.from('deal_radar').update({ status }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => invalidate(qc),
  })
}

/** Messaging the owner IS approving it — flip New → Approved and stamp the reach-out. */
export function useMarkApproved() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('deal_radar')
        .update({ status: 'approved', messaged_at: new Date().toISOString() })
        .eq('id', id)
        .eq('status', 'new') // don't stomp a later status on a re-click
      if (error) throw error
    },
    onSuccess: () => invalidate(qc),
  })
}

/** Free-text notes + backup owner channel (M5) edited from the detail sheet. */
export function useUpdateDealRadar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      ...values
    }: { id: string } & Partial<Pick<DealRadarRow, 'notes' | 'owner_phone' | 'owner_email'>>) => {
      const { error } = await supabase.from('deal_radar').update(values).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => invalidate(qc),
  })
}

/** Set sale/lease intent by hand — for the "?" ones the title didn't state. */
export function useSetDealRadarIntent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, intent }: { id: string; intent: DealRadarIntent }) => {
      const { error } = await supabase.from('deal_radar').update({ listing_intent: intent }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => invalidate(qc),
  })
}

/** Distinct Facebook locations present in the live feed, for the location filter. */
export function useDealRadarLocations() {
  return useQuery({
    queryKey: ['deal_radar', 'locations'],
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from('deal_radar')
        .select('location_text')
        .not('location_text', 'is', null)
        .neq('status', 'declined')
      if (error) throw error
      const set = new Set<string>()
      for (const r of data ?? []) if (r.location_text) set.add(r.location_text)
      return [...set].sort()
    },
  })
}

/**
 * New Facebook listings awaiting dashboard triage (status 'new'), grouped by
 * sale/lease/unknown. The human approves (✓) or declines (✗) each; either moves
 * it out of 'new' so the widget only ever shows what still needs a decision.
 */
export function useFacebookTriage() {
  return useQuery({
    queryKey: ['deal_radar', 'triage'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('deal_radar')
        .select('*')
        .eq('status', 'new')
        .order('found_at', { ascending: false })
        .limit(200)
      if (error) throw error
      const rows = (data ?? []) as DealRadarRow[]
      const groups: Record<DealRadarIntent, DealRadarRow[]> = { sale: [], lease: [], unknown: [] }
      for (const r of rows) groups[r.listing_intent].push(r)
      return { rows, groups, total: rows.length }
    },
  })
}

/** "Decline all" for one tab — send every new listing of an intent to Declined. */
export function useDeclineFacebookIntent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (intent: DealRadarIntent) => {
      const { error } = await supabase
        .from('deal_radar')
        .update({ status: 'declined' })
        .eq('status', 'new')
        .eq('listing_intent', intent)
      if (error) throw error
    },
    onSuccess: () => invalidate(qc),
  })
}
