import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Enums } from '@/lib/database.types'

export type DashMatch = {
  id: string
  created_at: string
  inquiry_date: string | null
  tour_date: string | null
  executed_date: string | null
  stage: Enums<'pursuit_stage'>
  flagged_new: boolean
  actual_fee: number | null
  /** alias of client_id, for routing to the tenant board */
  tenant_rep_id: string | null
  property: { id: string; address: string; city: string | null; state: string | null } | null
  tenant_company: { name: string } | null
  tenant_contact: { first_name: string; last_name: string | null } | null
}

type PursuitDashRow = {
  id: string
  created_at: string
  inquiry_date: string | null
  tour_date: string | null
  executed_date: string | null
  stage: Enums<'pursuit_stage'>
  flagged_new: boolean
  actual_fee: number | null
  client_id: string | null
  property: { id: string; address: string; city: string | null; state: string | null } | null
  client: {
    company: { name: string } | null
    contact: { first_name: string; last_name: string | null } | null
  } | null
}

/** Pursuits with their stage dates + executed fees — powers the dashboard activity widgets. */
export function useDashboardMatches() {
  return useQuery({
    queryKey: ['dashboard-matches'],
    queryFn: async (): Promise<DashMatch[]> => {
      const { data, error } = await supabase
        .from('pursuits')
        .select(
          'id, created_at, inquiry_date, tour_date, executed_date, stage, flagged_new, actual_fee, client_id, property:properties!pursuits_property_id_fkey(id, address, city, state), client:clients!pursuits_client_id_fkey(company:companies!clients_company_id_fkey(name), contact:contacts!clients_contact_id_fkey(first_name, last_name))',
        )
      if (error) throw error
      return ((data ?? []) as unknown as PursuitDashRow[]).map((p) => ({
        id: p.id,
        created_at: p.created_at,
        inquiry_date: p.inquiry_date,
        tour_date: p.tour_date,
        executed_date: p.executed_date,
        stage: p.stage,
        flagged_new: p.flagged_new,
        actual_fee: p.actual_fee,
        tenant_rep_id: p.client_id,
        property: p.property,
        tenant_company: p.client?.company ?? null,
        tenant_contact: p.client?.contact ?? null,
      }))
    },
  })
}

/** Commission booked on an executed pursuit. */
export function matchFee(m: DashMatch): number {
  return m.actual_fee ?? 0
}

/** ISO timestamp 7 days ago — the trailing window for the daily-refreshed dashboard feeds. */
const sevenDaysAgoIso = () => new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

export type OffMarketProperty = {
  id: string
  address: string
  city: string | null
  state: string | null
  listing_url: string | null
  building_sf: number | null
  property_type: Enums<'property_kind'> | null
  updated_at: string
}

const OFF_MARKET_CLEARED_KEY = 'off-market:cleared-at'

/** Feed floor: 7 days back, or the last "clear" if more recent (same as new-listings). */
function offMarketFloorIso(): string {
  const weekAgo = sevenDaysAgoIso()
  let cleared: string | null = null
  try {
    cleared = window.localStorage.getItem(OFF_MARKET_CLEARED_KEY)
  } catch {
    cleared = null
  }
  return cleared && cleared > weekAgo ? cleared : weekAgo
}

/**
 * Properties flipped to off_market in the last 7 days (present last sweep, gone this
 * one), most recently first. Powers the dashboard "New off-market" widget.
 */
export function useRecentlyOffMarket() {
  return useQuery({
    queryKey: ['recently-off-market'],
    queryFn: async (): Promise<OffMarketProperty[]> => {
      const { data, error } = await supabase
        .from('properties')
        .select(
          'id, address, city, state, listing_url, building_sf, property_type, updated_at',
        )
        .eq('listing_status', 'off_market')
        .gte('updated_at', offMarketFloorIso())
        .order('updated_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return (data ?? []) as OffMarketProperty[]
    },
  })
}

/** Clear the off-market feed: stamps now as the floor until the next sweep flips more. */
export function useClearOffMarket() {
  const qc = useQueryClient()
  return () => {
    try {
      window.localStorage.setItem(OFF_MARKET_CLEARED_KEY, new Date().toISOString())
    } catch {
      // ignore storage errors — clearing is best-effort
    }
    qc.invalidateQueries({ queryKey: ['recently-off-market'] })
  }
}

export type NewListing = {
  id: string
  address: string
  city: string | null
  state: string | null
  listing_url: string | null
  building_sf: number | null
  land_acres: number | null
  property_type: Enums<'property_kind'> | null
  created_at: string
}

/** Most rows we'll render in the widget; the badge still reports the true total. */
const NEW_LISTINGS_RENDER_CAP = 100
const NEW_LISTINGS_CLEARED_KEY = 'new-listings:cleared-at'

/**
 * Floor for the "new listings" feed: the last 7 days, or — if the broker has cleared the
 * feed more recently — everything imported since that clear. Clearing zeroes the widget
 * until the next sweep brings genuinely new listings.
 */
function newListingsFloorIso(): string {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  let cleared: string | null = null
  try {
    cleared = window.localStorage.getItem(NEW_LISTINGS_CLEARED_KEY)
  } catch {
    cleared = null
  }
  return cleared && cleared > weekAgo ? cleared : weekAgo
}

/**
 * The widget's default lens: LoopNet's deep pagination pads county searches with
 * "related" retail/office listings — those still import (they feed county market
 * intel), but the feed defaults to the types Alex actually works.
 */
export type NewListingsTypeFilter = 'industrial' | 'all'
const INDUSTRIAL_FEED_KINDS = 'industrial,land,other'

/**
 * Scraped properties imported since the feed's floor (7 days, or the last "clear") — the
 * daily-refreshed "new listings" feed that replaced the auto-matching suggestions. Each can be added
 * to a client. Returns the capped rows to render plus the true total (a bulk sweep can
 * import thousands at once, so the badge must not under-report at the render cap).
 */
export function useNewListings(filter: NewListingsTypeFilter = 'industrial') {
  return useQuery({
    queryKey: ['new-listings', filter],
    // Toggling the filter switches the key; without previous data the widget would
    // momentarily see allTotal 0 and unmount itself mid-tap.
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<{ items: NewListing[]; total: number; allTotal: number }> => {
      const floor = newListingsFloorIso()
      let q = supabase
        .from('properties')
        .select(
          'id, address, city, state, listing_url, building_sf, land_acres, property_type, created_at',
          { count: 'exact' },
        )
        .eq('source', 'scrape')
        .eq('listing_status', 'on_market')
        .gte('created_at', floor)
      if (filter === 'industrial') {
        q = q.or(`property_type.in.(${INDUSTRIAL_FEED_KINDS}),property_type.is.null`)
      }
      const { data, error, count } = await q
        .order('created_at', { ascending: false })
        .limit(NEW_LISTINGS_RENDER_CAP)
      if (error) throw error
      const items = (data ?? []) as NewListing[]
      const total = count ?? items.length

      // The widget hides only when NOTHING is new — the filtered lens still needs the
      // unfiltered count so "0 industrial, 37 total" renders the toggle.
      let allTotal = total
      if (filter === 'industrial') {
        const { count: all, error: allErr } = await supabase
          .from('properties')
          .select('id', { count: 'exact', head: true })
          .eq('source', 'scrape')
          .eq('listing_status', 'on_market')
          .gte('created_at', floor)
        if (allErr) throw allErr
        allTotal = all ?? total
      }
      return { items, total, allTotal }
    },
  })
}

/**
 * Clear the "new listings" feed: stamps now as the floor so the widget reads zero
 * until the next sweep imports new listings. (Per-browser via localStorage.)
 */
export function useClearNewListings() {
  const qc = useQueryClient()
  return () => {
    try {
      window.localStorage.setItem(NEW_LISTINGS_CLEARED_KEY, new Date().toISOString())
    } catch {
      // ignore storage errors — clearing is best-effort
    }
    qc.invalidateQueries({ queryKey: ['new-listings'] })
  }
}
