import { useMemo } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { PropertyBook, PropertyWithCounts } from '@/hooks/use-properties'
import type { OwnerContext } from '@/hooks/use-owners'

/**
 * The camera. Only the bounds reach the database; `zoom` rides along because the caller
 * needs it to decide whether parcel outlines are on screen, and the box is derived from
 * the bounds alone so it stays out of the query key.
 */
export type MapViewport = {
  south: number
  west: number
  north: number
  east: number
  zoom: number
}

/**
 * How many pins one request may carry.
 *
 * 1000 is PostgREST's own ceiling — ask for more and it silently returns 1000 anyway, so
 * the number here matches what can actually arrive rather than pretending otherwise. It
 * still clears the map's marker cap (800 on desktop) with room to spare, and the RPC
 * reports the true count in the box so a crowded viewport says "800 of 1,860" instead of
 * implying that what arrived is everything.
 */
export const MAP_VIEWPORT_LIMIT = 1000

/**
 * Snap the camera outward to a ~2km grid, with a quarter-viewport of margin.
 *
 * Two things fall out of this. The margin means a small pan lands on pins that are
 * already loaded, so markers appear the moment the drag stops rather than after a round
 * trip. The snapping means nudging the map a block over produces the SAME box — the same
 * query key — so React Query serves it from cache instead of asking again. Only a real
 * move to somewhere new costs a request.
 */
const GRID = 0.02
const MARGIN = 0.25

type Box = { south: number; west: number; north: number; east: number }

function snapBox(v: MapViewport): Box {
  const padLat = (v.north - v.south) * MARGIN
  const padLng = (v.east - v.west) * MARGIN
  // Rounded to 4dp as well as snapped: floating-point noise in the key would defeat the
  // cache hit the snapping exists to produce.
  const down = (x: number) => Number((Math.floor(x / GRID) * GRID).toFixed(4))
  const up = (x: number) => Number((Math.ceil(x / GRID) * GRID).toFixed(4))
  return {
    south: Math.max(-90, down(v.south - padLat)),
    west: Math.max(-180, down(v.west - padLng)),
    north: Math.min(90, up(v.north + padLat)),
    east: Math.min(180, up(v.east + padLng)),
  }
}

export type MapPropertiesResult = {
  properties: PropertyWithCounts[]
  ownerContext: Map<string, OwnerContext>
  /** How many properties the box actually holds, before the cap — for "1,200 of 3,386". */
  totalInView: number
}

const EMPTY: MapPropertiesResult = {
  properties: [],
  ownerContext: new Map(),
  totalInView: 0,
}

/** Both map RPCs return the same three columns, so they unpack the same way. */
type MapRow = { property: unknown; owner_ctx: unknown; total_in_view: number }

type RpcProperty = PropertyWithCounts & { listing_count?: number; pursuit_count?: number }

function unpack(rows: MapRow[]): MapPropertiesResult {
  const properties: PropertyWithCounts[] = []
  const ownerContext = new Map<string, OwnerContext>()
  for (const row of rows) {
    const raw = row.property as RpcProperty
    // The RPC counts linked deals as two plain columns; the book gets the same numbers as
    // PostgREST count-embeds. Reshaped here so a map row and a book row are interchangeable
    // everywhere downstream — which is what lets the table search through this RPC too.
    const p: PropertyWithCounts = {
      ...raw,
      listings: [{ count: raw.listing_count ?? 0 }],
      matches: [{ count: raw.pursuit_count ?? 0 }],
    }
    properties.push(p)
    if (row.owner_ctx) ownerContext.set(p.id, row.owner_ctx as OwnerContext)
  }
  return { properties, ownerContext, totalInView: rows[0]?.total_in_view ?? 0 }
}

/**
 * The properties inside the current camera, with their owner context attached.
 *
 * The map's data source when nothing is being searched for. Plotting from the whole book
 * meant ~17k properties and ~17k rows of owner context before a single pin could appear;
 * a viewport holds a few hundred, and the database can hand those over — owner context
 * and all — in one round trip. Pins are therefore no longer opt-in: zoom anywhere and the
 * properties there are on screen and clickable, with no search to type first.
 */
export function useMapProperties(
  viewport: MapViewport | null,
  enabled = true,
  book: PropertyBook = 'all',
) {
  const box = useMemo(
    () => (viewport ? snapBox(viewport) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [viewport?.south, viewport?.west, viewport?.north, viewport?.east],
  )

  const query = useQuery({
    queryKey: ['map-properties', book, box],
    enabled: enabled && box != null,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    // Hold the pins from the previous box on screen while the new one loads, so panning
    // doesn't strobe the map empty between frames.
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<MapPropertiesResult> => {
      const { data, error } = await supabase.rpc('map_properties', {
        p_min_lat: box!.south,
        p_min_lng: box!.west,
        p_max_lat: box!.north,
        p_max_lng: box!.east,
        p_limit: MAP_VIEWPORT_LIMIT,
        // 'all' asks the legacy question (no book filter) — the RPC treats null that way
        p_book: book === 'all' ? undefined : book,
      })
      if (error) throw error
      return unpack((data ?? []) as MapRow[])
    },
  })

  return { ...query, data: query.data ?? EMPTY }
}

/**
 * How many typed matches one search may return.
 *
 * PostgREST's own ceiling, and well past the map's marker cap — a query broad enough to
 * hit it ("Tampa") is one to narrow, not to scroll. `searchCapped` below says so out loud
 * rather than letting a truncated set read as the whole answer.
 */
export const MAP_SEARCH_LIMIT = 1000

/**
 * Properties matching a typed query, straight from Postgres.
 *
 * The page used to answer a search by pulling the whole book and matching in the browser
 * against a haystack built from every row — ~20 seconds before the first result, and it
 * could only ever match the address. Postgres already knows what a match is
 * (`search_properties()`, ~100ms over trigram indexes) and knows far more about the
 * property than the browser does: it matches the owning entity, the county's owner of
 * record, the person the skip trace attached, and the tenant on a lease comp.
 *
 * Matching is NOT repeated on the client. Postgres has already decided, and re-filtering
 * here would quietly drop every hit that came from a name or a parcel number — none of
 * which are in the browser's haystack.
 */
export function useMapSearch(query: string, enabled = true, book: PropertyBook = 'all') {
  const q = query.trim()
  const result = useQuery({
    queryKey: ['map-search', book, q],
    enabled: enabled && q.length > 0,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<MapPropertiesResult> => {
      const { data, error } = await supabase.rpc('search_map_properties', {
        p_query: q,
        p_limit: MAP_SEARCH_LIMIT,
        p_book: book === 'all' ? undefined : book,
      })
      if (error) throw error
      return unpack((data ?? []) as MapRow[])
    },
  })
  const data = result.data ?? EMPTY
  return { ...result, data, searchCapped: data.properties.length >= MAP_SEARCH_LIMIT }
}

/** One typeahead suggestion — what the dropdown needs and nothing else. */
export type SearchSuggestion = { id: string; address: string; city: string | null; county: string | null }

/**
 * Google-style typeahead for the search box: top-8 address matches while typing,
 * from suggest_properties (prefix-first over search_text, ~60ms). Deliberately
 * separate from useMapSearch — the committed search is thorough and ~900ms, far
 * too heavy to run per keystroke, which is exactly why the box stopped doing
 * that. Suggestions are the light preview; Enter still runs the real thing.
 */
export function useSearchSuggestions(query: string, enabled = true) {
  const q = query.trim()
  return useQuery({
    queryKey: ['search-suggest', q],
    enabled: enabled && q.length >= 3,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('suggest_properties', { p_query: q, p_limit: 8 })
      if (error) throw error
      return (data ?? []) as SearchSuggestion[]
    },
  })
}
