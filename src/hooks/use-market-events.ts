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

/** Every event tied to one property — the "Property history" section, all statuses. */
export function usePropertyMarketEvents(propertyId: string | undefined) {
  return useQuery({
    queryKey: ['market_events', 'property', propertyId],
    enabled: !!propertyId,
    queryFn: async (): Promise<MarketEventRow[]> => {
      const { data, error } = await supabase
        .from('market_events')
        .select('*')
        .eq('property_id', propertyId!)
        .order('event_date', { ascending: false, nullsFirst: false })
        .order('first_seen_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return data ?? []
    },
  })
}

export interface MarketEventAlert {
  event_id: string
  event_type: MarketEventType
  title: string
  url: string | null
  event_date: string | null
  first_seen_at: string
  property_id: string
  address: string | null
  city: string | null
  owner_name: string | null
  contact_name: string | null
  contact_phone: string | null
}

/**
 * NEW events on properties whose owner has a VERIFIED contact — the dashboard
 * popup. The rule lives in Postgres (market_event_alerts, security invoker so
 * the VA silo applies); rows leave when the event is marked seen/dismissed.
 */
export function useMarketEventAlerts() {
  return useQuery({
    queryKey: ['market_events', 'alerts'],
    queryFn: async (): Promise<MarketEventAlert[]> => {
      const { data, error } = await supabase.rpc('market_event_alerts', { p_limit: 20 })
      if (error) throw error
      return (data ?? []) as MarketEventAlert[]
    },
  })
}

/** Human label for a market_events source key (shared by the feed + property history). */
export function marketSourceLabel(source: string): string {
  const fixed: Record<string, string> = {
    tampa_permits: 'Tampa permits',
    hcfl_permits: 'Hillsborough Co permits',
    hc_zoning_hearings: 'Hillsborough hearings',
    hc_code_enforcement: 'Hillsborough code enforcement',
    hc_lis_pendens: 'Hillsborough lis pendens',
    manatee_lis_pendens: 'Manatee lis pendens',
    hc_life_events: 'Hillsborough probate/divorce/death',
    manatee_life_events: 'Manatee probate/death',
    flmb_bankruptcy: 'Bankruptcy court (MDFL)',
  }
  if (fixed[source]) return fixed[source]
  const sale = /^county_sales:(\w+)/.exec(source)
  if (sale) return sale[1][0].toUpperCase() + sale[1].slice(1) + ' sales'
  return source
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
