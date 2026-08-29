import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Enums, Tables } from '@/lib/database.types'

export type DealRadarStatus = Enums<'deal_radar_status'>
export type DealRadarType = Enums<'deal_radar_type'>
export type DealRadarSource = Enums<'deal_radar_source'>
export type DealRadarRow = Tables<'deal_radar'>

export interface DealRadarFilters {
  /** null = the default working set (everything not dead/converted). */
  status?: DealRadarStatus | 'open' | null
  market?: string | null
  type?: DealRadarType | null
  source?: DealRadarSource | null
  minPrice?: number | null
  maxPrice?: number | null
  minSqft?: number | null
}

const OPEN_STATUSES: DealRadarStatus[] = ['new', 'messaged', 'replied', 'negotiating']

/**
 * The radar feed, newest first. Default (`status: 'open'`) hides dead/converted;
 * pass a concrete status to pin one column, or null for everything.
 */
export function useDealRadar(filters: DealRadarFilters = { status: 'open' }) {
  return useQuery({
    queryKey: ['deal_radar', filters],
    queryFn: async (): Promise<DealRadarRow[]> => {
      let q = supabase.from('deal_radar').select('*').order('found_at', { ascending: false }).limit(500)
      if (filters.status === 'open') q = q.in('status', OPEN_STATUSES)
      else if (filters.status) q = q.eq('status', filters.status)
      if (filters.market) q = q.eq('market', filters.market)
      if (filters.type) q = q.eq('listing_type', filters.type)
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

/** Optimistic flip to Messaged when the human copies + opens the listing. */
export function useMarkMessaged() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('deal_radar')
        .update({ status: 'messaged', messaged_at: new Date().toISOString() })
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
