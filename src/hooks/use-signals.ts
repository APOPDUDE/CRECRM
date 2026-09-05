import { useMemo } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Tables } from '@/lib/database.types'
import { EVENT_TYPE_ORDER, type MarketEventType } from '@/lib/market-events'
import { unpackMapRows, type MapPropertiesResult } from '@/hooks/use-map-properties'

/**
 * The War Room's Signals lens (Alex 2026-09-05): the Market Monitor's events, plotted.
 *
 * Two fetches, both small. The events are every market_events row that matched a book
 * property — a few hundred, one request, no book. The properties behind them come from
 * map_properties_by_ids, the same shape the viewport and search RPCs return, so the
 * page's filter pass, table, hover cards and export work on them unchanged.
 */
export type SignalEvent = Pick<
  Tables<'market_events'>,
  'id' | 'property_id' | 'event_type' | 'event_date' | 'title' | 'url' | 'status' | 'first_seen_at' | 'source'
>

const SELECT = 'id, property_id, event_type, event_date, title, url, status, first_seen_at, source'

export function useSignalEvents(enabled = true) {
  return useQuery({
    queryKey: ['market_events', 'signals'],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<SignalEvent[]> => {
      // Page by range: PostgREST silently caps a request at 1000 rows, and the matched
      // set will pass that as the sales feed accumulates.
      const PAGE = 1000
      const out: SignalEvent[] = []
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from('market_events')
          .select(SELECT)
          .not('property_id', 'is', null)
          .order('first_seen_at', { ascending: false })
          .range(from, from + PAGE - 1)
        if (error) throw error
        out.push(...((data ?? []) as SignalEvent[]))
        if ((data?.length ?? 0) < PAGE) break
      }
      return out
    },
  })
}

export type SignalSummary = {
  /** The most serious type on the property — what the pin is coloured by. */
  top: MarketEventType
  types: MarketEventType[]
  /** Newest event_date (falls back to first_seen) across the kept events. */
  latest: string | null
  events: SignalEvent[]
}

const RANK = new Map(EVENT_TYPE_ORDER.map((t, i) => [t, i]))

/** The event's own date, else the day we first saw it — never a null bucket. */
function eventDay(e: SignalEvent): string {
  return e.event_date ?? e.first_seen_at.slice(0, 10)
}

/**
 * Fold the events into one summary per property, keeping only the chosen types inside
 * the window. `since` is an ISO date (inclusive) or null for everything.
 */
export function summarizeSignals(
  events: SignalEvent[] | undefined,
  types: ReadonlySet<MarketEventType>,
  since: string | null,
): Map<string, SignalSummary> {
  const m = new Map<string, SignalSummary>()
  for (const e of events ?? []) {
    if (!e.property_id || !types.has(e.event_type)) continue
    const day = eventDay(e)
    if (since && day < since) continue
    let s = m.get(e.property_id)
    if (!s) {
      s = { top: e.event_type, types: [], latest: null, events: [] }
      m.set(e.property_id, s)
    }
    s.events.push(e)
    if (!s.types.includes(e.event_type)) s.types.push(e.event_type)
    if ((RANK.get(e.event_type) ?? 99) < (RANK.get(s.top) ?? 99)) s.top = e.event_type
    if (s.latest == null || day > s.latest) s.latest = day
  }
  for (const s of m.values()) {
    s.types.sort((a, b) => (RANK.get(a) ?? 99) - (RANK.get(b) ?? 99))
    s.events.sort((a, b) => eventDay(b).localeCompare(eventDay(a)))
  }
  return m
}

const EMPTY: MapPropertiesResult = { properties: [], ownerContext: new Map(), totalInView: 0 }

/** The list-slice rows (+ owner context) for a set of property ids, in one round trip. */
export function useSignalProperties(ids: string[], enabled = true) {
  // Sorted so the same set in a different order is the same cache entry.
  const key = useMemo(() => [...ids].sort().join(','), [ids])
  const query = useQuery({
    queryKey: ['map-properties-by-ids', key],
    enabled: enabled && ids.length > 0,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<MapPropertiesResult> => {
      const { data, error } = await supabase.rpc('map_properties_by_ids', { p_ids: key.split(',') })
      if (error) throw error
      return unpackMapRows(data ?? [])
    },
  })
  return { ...query, data: query.data ?? EMPTY }
}
