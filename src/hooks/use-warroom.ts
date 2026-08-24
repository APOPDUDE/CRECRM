import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { PropertyWithCounts } from '@/hooks/use-properties'
import type { OwnerContext } from '@/hooks/use-owners'
import type { LatLng } from '@/lib/geo'

/**
 * The War Room's filter set, as Postgres receives it.
 *
 * One object, built once from the page's state and passed verbatim to every server call,
 * so the page, the counts and the export can never be answering slightly different
 * questions. The keys are the contract with `warroom_predicate` — changing one here
 * without changing it there silently drops a filter rather than erroring.
 */
export type WarroomFilters = {
  book: 'industrial' | 'land'
  portfolio_owner_id?: string | null
  q?: string | null
  county?: string
  ptype?: string
  status?: string
  deal_type?: string
  psf_min?: number | null
  psf_max?: number | null
  price_min?: number | null
  price_max?: number | null
  include_unpriced?: boolean
  owner_filter?: string
  channels?: { phone: boolean; email: boolean }
  activity?: string
  /** Frozen at mount by the caller — never `now()`, or rows reshuffle as the clock ticks. */
  activity_cutoff?: string
  /** The CLIENT's local date. Postgres must not substitute current_date: it is UTC. */
  today: string
  sf_min?: number | null
  sf_max?: number | null
  ac_min?: number | null
  ac_max?: number | null
  sold_years?: number | null
  include_no_sale?: boolean
  include_condos?: boolean
  tags?: string[]
  owner_occ_mode?: string
  zoning?: string
  use_bucket?: string
  dor?: unknown
  /** Postgres polygon literal, '((lng,lat),(lng,lat),…)'. NOTE x=lng — see toPolygonLiteral. */
  polygon?: string | null
  lease_applies?: boolean
  lease?: unknown
  overlays?: Record<string, { sel: unknown; mode: 'include' | 'only' | 'both' }>
}

/**
 * A drawn shape as Postgres's `polygon` type.
 *
 * x is LONGITUDE and y is LATITUDE. Getting that backwards does not error — it silently
 * matches nothing, because Florida's longitudes land nowhere near its latitudes.
 * Returns null below three vertices: a line has no inside.
 */
export function toPolygonLiteral(poly: LatLng[] | null | undefined): string | null {
  if (!poly || poly.length < 3) return null
  return `(${poly.map((p) => `(${p.lng},${p.lat})`).join(',')})`
}

/** Both War Room RPCs return v_map_property rows, so they unpack like map rows do. */
type PageRow = { property: unknown; owner_ctx: unknown }
type RpcProperty = PropertyWithCounts & { listing_count?: number; pursuit_count?: number }

export type WarroomPage = {
  properties: PropertyWithCounts[]
  ownerContext: Map<string, OwnerContext>
}

const EMPTY_PAGE: WarroomPage = { properties: [], ownerContext: new Map() }

function unpackPage(rows: PageRow[]): WarroomPage {
  const properties: PropertyWithCounts[] = []
  const ownerContext = new Map<string, OwnerContext>()
  for (const row of rows) {
    const raw = row.property as RpcProperty
    // Reshaped so a page row and a map row are interchangeable everywhere downstream —
    // the same trick `use-map-properties` plays, and what lets one renderer serve both.
    properties.push({
      ...raw,
      listings: [{ count: raw.listing_count ?? 0 }],
      matches: [{ count: raw.pursuit_count ?? 0 }],
    })
    if (row.owner_ctx) ownerContext.set(raw.id, row.owner_ctx as OwnerContext)
  }
  return { properties, ownerContext }
}

/**
 * One page of matching properties, filtered and ordered by Postgres.
 *
 * This is what replaced fetching the book. The page is an indexed LIMIT — 27 ms warm for
 * the industrial book's first page, against ~26 seconds to pull 127,007 rows and filter
 * them in the browser.
 *
 * Deliberately NOT paired with the total in one call: an exact count has to walk the whole
 * matching set, and making first paint wait on it gives back most of what this bought.
 * {@link useWarroomCounts} runs alongside and the count fills in when it lands.
 */
export function useWarroomPage(
  filters: WarroomFilters | null,
  offset: number,
  limit: number,
  enabled = true,
  /**
   * The table needs address order; the map does not — it just needs a screenful of pins.
   * Ordering forces Postgres to find and sort EVERY match before applying the limit, and
   * with a drawn shape (which no btree can serve) that was 15 s and a 500. Unordered lets
   * the scan stop at `limit`. The cost is that a capped map shows "the first N found"
   * rather than a spatially fair sample, which is why it still says "N of M — zoom in".
   */
  ordered = true,
) {
  const query = useQuery({
    queryKey: ['warroom-page', filters, offset, limit, ordered],
    enabled: enabled && filters != null,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    // Hold the previous page on screen while the next loads, so paging and filtering
    // don't strobe the table empty between frames.
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<WarroomPage> => {
      const { data, error } = await supabase.rpc('warroom_page', {
        p_filters: filters as never,
        p_offset: offset,
        p_limit: limit,
        p_ordered: ordered,
      })
      if (error) throw error
      return unpackPage((data ?? []) as PageRow[])
    },
  })
  return { ...query, data: query.data ?? EMPTY_PAGE }
}

export type WarroomCounts = { total: number; condoHidden: number }

/**
 * The honest total, and what the condo lens removed from THIS view.
 *
 * Slower than the page by design — it is the only thing here that must touch every
 * matching row — so it is a separate query the UI can show a spinner for. With any filter
 * narrowing the set it is fast (78 ms with a county picked); it is the unfiltered whole
 * book that costs ~2 s, and that is the one case where the number matters least.
 */
export function useWarroomCounts(filters: WarroomFilters | null, enabled = true) {
  const query = useQuery({
    queryKey: ['warroom-counts', filters],
    enabled: enabled && filters != null,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<WarroomCounts> => {
      const { data, error } = await supabase.rpc('warroom_counts', { p_filters: filters as never })
      if (error) throw error
      const row = (data ?? [])[0] as { total: number; condo_hidden: number } | undefined
      return { total: Number(row?.total ?? 0), condoHidden: Number(row?.condo_hidden ?? 0) }
    },
  })
  return { ...query, data: query.data ?? null }
}

/**
 * The counties the County dropdown offers.
 *
 * Used to be derived from the book — `new Set(book.map(p => p.county))` — which was free
 * only because the whole book happened to be in memory. It is not any more, and deriving
 * it from one page would offer whichever counties page 1 happens to contain. `county_lookup`
 * is the city→county map and is tiny, so the distinct set is the honest answer for pennies.
 */
export function useCountyOptions() {
  return useQuery({
    queryKey: ['county-options'],
    staleTime: 60 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from('county_lookup')
        .select('county')
        .not('county', 'is', null)
        .limit(5000)
      if (error) throw error
      const set = new Set<string>()
      for (const r of data ?? []) if (r.county) set.add(r.county)
      return [...set].sort()
    },
  })
}

/**
 * How many ids one export may carry. The land book is ~100k, so this is not a "nobody
 * will hit it" cap — `truncated` says so out loud rather than shipping a short file.
 */
export const WARROOM_IDS_CAP = 200_000

/**
 * Every matching id, for the three things that legitimately need the whole set: the CSV
 * export, the bulk GHL push and the owner blast. All are click-time, so none of them is
 * on the first-paint path — which is exactly why the page no longer has to be.
 *
 * Not a hook: it runs when a dialog opens, not while a component renders.
 */
export async function fetchWarroomIds(
  filters: WarroomFilters,
  cap = WARROOM_IDS_CAP,
): Promise<{ ids: string[]; truncated: boolean }> {
  const { data, error } = await supabase.rpc('warroom_ids', {
    p_filters: filters as never,
    p_cap: cap,
  })
  if (error) throw error
  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id)
  return { ids, truncated: ids.length >= cap }
}
