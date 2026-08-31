import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Enums, Tables } from '@/lib/database.types'

export type MarketEventType = Enums<'market_event_type'>
export type MarketEventStatus = Enums<'market_event_status'>
export type MarketEventRow = Tables<'market_events'>

export interface MarketEventFilters {
  status?: MarketEventStatus | 'all'
  type?: MarketEventType | null
  source?: string | null
  /** true = only events matched to a book property. */
  matchedOnly?: boolean
}

/**
 * The off-market event feed (permits today; sales + zoning changes ride the same
 * table when their sources land). Newest first by when WE first saw the event —
 * event_date can be years back when a source re-touches an old record.
 */
export function useMarketEvents(filters: MarketEventFilters = { status: 'new' }) {
  return useQuery({
    queryKey: ['market_events', filters],
    queryFn: async (): Promise<MarketEventRow[]> => {
      let q = supabase
        .from('market_events')
        .select('*')
        .order('first_seen_at', { ascending: false })
        .limit(500)
      if (filters.status && filters.status !== 'all') q = q.eq('status', filters.status)
      if (filters.type) q = q.eq('event_type', filters.type)
      if (filters.source) q = q.eq('source', filters.source)
      if (filters.matchedOnly) q = q.not('property_id', 'is', null)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })
}

/** Tab badge counts, one cheap head-count per status. */
export function useMarketEventCounts() {
  return useQuery({
    queryKey: ['market_events', 'counts'],
    queryFn: async () => {
      const count = async (status: MarketEventStatus) => {
        const { count: n, error } = await supabase
          .from('market_events')
          .select('id', { count: 'exact', head: true })
          .eq('status', status)
        if (error) throw error
        return n ?? 0
      }
      const [newN, seenN, dismissedN] = await Promise.all([
        count('new'),
        count('seen'),
        count('dismissed'),
      ])
      return { new: newN, seen: seenN, dismissed: dismissedN }
    },
  })
}

/**
 * Per-source freshness — the same market_monitor_health() the n8n watchdog reads:
 * {source: seconds since that source last sent anything}.
 */
export function useMarketMonitorHealth() {
  return useQuery({
    queryKey: ['market_events', 'health'],
    queryFn: async (): Promise<Record<string, number>> => {
      const { data, error } = await supabase.rpc('market_monitor_health')
      if (error) throw error
      return (data ?? {}) as Record<string, number>
    },
    refetchInterval: 5 * 60_000,
  })
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['market_events'] })
}

/** Move one or many events between new / seen / dismissed. */
export function useUpdateMarketEventStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: MarketEventStatus }) => {
      if (ids.length === 0) return
      const { error } = await supabase.from('market_events').update({ status }).in('id', ids)
      if (error) throw error
    },
    onSuccess: () => invalidate(qc),
  })
}
