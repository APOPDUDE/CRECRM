import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { geocodeAddress } from '@/lib/geocode'
import type { Enums, Tables, TablesInsert, TablesUpdate } from '@/lib/database.types'

/**
 * Background-geocode properties that lack coordinates. Runs in the browser (whose
 * Referer satisfies Nominatim's policy — the scrape actor returns no lat/lng, and
 * the n8n server IP is rate-limited). Processes a small batch per mount.
 */
export function useGeocodeMissing(enabled = true) {
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void (async () => {
      const { data } = await supabase
        .from('properties')
        .select('id, address, city, state, zip')
        .is('lat', null)
        .not('address', 'is', null)
        // skip scrape placeholders ("Address unavailable", "Portfolio of N...") that can never
        // geocode — otherwise they sit in the lat-null set forever and clog the batch.
        .not('address', 'ilike', '%unavailable%')
        .not('address', 'ilike', 'Portfolio of %')
        .limit(25)
      if (!data || cancelled) return
      let any = false
      for (const p of data) {
        if (cancelled) return
        const geo = await geocodeAddress(p)
        if (geo) {
          await supabase.from('properties').update({ lat: geo.lat, lng: geo.lng }).eq('id', p.id)
          any = true
        }
        await new Promise((r) => setTimeout(r, 1100))
      }
      if (any && !cancelled) {
        queryClient.invalidateQueries({ queryKey: ['properties'] })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [enabled, queryClient])
}

/**
 * The list-page slice of a property — every column the table, map, filters, quick-edit
 * form and skip-trace export actually read. Deliberately NOT the full row: the book is
 * ~13k rows, and the full row carries multi-KB blobs (appraiser_data, scrape_facts,
 * photo_urls, description) that only the detail page needs — fetching them for the whole
 * book is what made the properties map take tens of seconds to load.
 */
export type Property = Pick<
  Tables<'properties'>,
  | 'id' | 'address' | 'city' | 'state' | 'zip' | 'county' | 'parcel_number'
  | 'site_address' | 'folio'
  | 'property_type' | 'gross_sf' | 'land_acres' | 'specs' | 'listing_status'
  | 'days_on_market' | 'year_built' | 'zoning_description' | 'zoning_district'
  | 'occupancy' | 'lat' | 'lng' | 'owner_company_id' | 'owner_name' | 'owner_mailing_address'
  | 'last_sale_date' | 'last_sale_price' | 'listing_url' | 'created_at' | 'updated_at'
  | 'zoning_type' | 'zoning_code' | 'zoning_jurisdiction' | 'dor_use_code'
> & {
  /**
   * `address` exactly as the source gave it to us, before the county situs address wins.
   * Listing sites market a building by a range ("4428-4450 Eagle Falls Pl") while the county,
   * every caller and every skip trace use one situs address ("4456 Eagle Falls Pl"). The edit
   * form writes this back, so opening and saving a property never silently swaps the two.
   */
  source_address: string | null
}

/** Property plus embedded linked-deal counts (listings + pursuits). */
export type PropertyWithCounts = Property & {
  listings: { count: number }[]
  matches: { count: number }[]
}

/** Total linked deals on a property: landlord listings + tenant pursuits. */
export function dealCount(p: Pick<PropertyWithCounts, 'listings' | 'matches'>): number {
  return (p.listings?.[0]?.count ?? 0) + (p.matches?.[0]?.count ?? 0)
}

/**
 * The whole book, paged in parallel.
 *
 * `enabled` exists because this is expensive — ~17k rows, and every consumer that mounts
 * it pays for all of them. The map no longer does: it loads by viewport (see
 * {@link import('./use-map-properties').useMapProperties}) and only reaches for the book
 * when a search or filter asks a question about properties that aren't on screen.
 */
export function useProperties(enabled = true) {
  return useQuery({
    queryKey: ['properties'],
    enabled,
    // The book is ~13k rows: refetching it on every mount made returning to the map feel
    // frozen. Cache for 5 minutes (mutations invalidate explicitly), don't refetch on
    // window focus, and fetch the pages IN PARALLEL (serial paging was 14 round-trips).
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const PAGE = 1000
      // explicit FK hints: listing_parcels adds a 2nd properties<->listings relationship,
      // so a bare listings(count) is ambiguous (PGRST201) and 300s the whole query.
      const SELECT =
        'id, address, city, state, zip, county, parcel_number, site_address, folio, ' +
        'property_type, gross_sf, ' +
        'land_acres, specs, listing_status, days_on_market, year_built, zoning_description, ' +
        'zoning_district, occupancy, lat, lng, owner_company_id, owner_name, owner_mailing_address, ' +
        'last_sale_date, last_sale_price, listing_url, created_at, updated_at, ' +
        'zoning_type, zoning_code, zoning_jurisdiction, dor_use_code, ' +
        'listings!listings_property_id_fkey(count), matches:pursuits!pursuits_property_id_fkey(count)'
      // count:'exact' only on the first page — it re-runs the full filtered count per
      // request, so repeating it on all ~14 parallel pages just multiplies server work.
      const base = (withCount?: boolean) =>
        supabase
          .from('properties')
          .select(SELECT, withCount ? { count: 'exact' } : undefined)
          // hide scrape placeholders that aren't real addresses — no coords/parcel/deals.
          .not('address', 'ilike', '%unavailable%')
          .not('address', 'ilike', 'Portfolio of %')
          // (address, id) — id is the unique tiebreaker keeping offset pages stable.
          .order('address')
          .order('id')
      const first = await base(true).range(0, PAGE - 1)
      if (first.error) throw first.error
      const total = first.count ?? (first.data?.length ?? 0)
      const rest = await Promise.all(
        Array.from({ length: Math.max(0, Math.ceil(total / PAGE) - 1) }, (_, i) =>
          base().range((i + 1) * PAGE, (i + 2) * PAGE - 1),
        ),
      )
      const all = [...(first.data ?? [])] as unknown as PropertyWithCounts[]
      for (const r of rest) {
        if (r.error) throw r.error
        all.push(...((r.data ?? []) as unknown as PropertyWithCounts[]))
      }
      // County records are the source of truth (Alex 2026-08-11), so the situs address is what
      // the whole app shows, searches, maps and exports — one swap here rather than a
      // `site_address ?? address` at every read site. The original stays on source_address.
      return all.map((p) => ({
        ...p,
        address: p.site_address ?? p.address,
        source_address: p.address,
      }))
    },
  })
}

export type PropertyListing = Pick<
  Tables<'listings'>,
  'id' | 'deal_type' | 'stage' | 'status' | 'asking_rate_psf' | 'asking_price' | 'lost_reason'
> & {
  landlord: Pick<Tables<'companies'>, 'id' | 'name'> | null
}

export type PropertyMatch = Pick<
  Tables<'pursuits'>,
  'id' | 'stage' | 'flagged_new' | 'inquiry_date'
> & {
  /** alias of client_id, for routing to the tenant board */
  tenant_rep_id: string
  tenant_company: Pick<Tables<'companies'>, 'id' | 'name'> | null
  tenant_contact: Pick<Tables<'contacts'>, 'id' | 'first_name' | 'last_name'> | null
}

type PropertyPursuitRow = Pick<Tables<'pursuits'>, 'id' | 'stage' | 'flagged_new' | 'inquiry_date'> & {
  client_id: string
  client: {
    company: Pick<Tables<'companies'>, 'id' | 'name'> | null
    contact: Pick<Tables<'contacts'>, 'id' | 'first_name' | 'last_name'> | null
  } | null
}

/** Landlord listings + tenant pursuits tied to a property — its association view. */
export function usePropertyDeals(propertyId: string | undefined) {
  return useQuery({
    queryKey: ['property-deals', propertyId],
    enabled: !!propertyId,
    queryFn: async () => {
      const [listingsRes, pursuitsRes] = await Promise.all([
        supabase
          .from('listings')
          .select(
            'id, deal_type, stage, status, asking_rate_psf, asking_price, lost_reason, landlord:companies!listings_landlord_company_id_fkey(id, name)',
          )
          .eq('property_id', propertyId!)
          .order('created_at', { ascending: false }),
        supabase
          .from('pursuits')
          .select(
            'id, stage, flagged_new, inquiry_date, client_id, client:clients!pursuits_client_id_fkey(company:companies!clients_company_id_fkey(id, name), contact:contacts!clients_contact_id_fkey(id, first_name, last_name))',
          )
          .eq('property_id', propertyId!)
          .order('inquiry_date', { ascending: false }),
      ])
      if (listingsRes.error) throw listingsRes.error
      if (pursuitsRes.error) throw pursuitsRes.error
      const matches: PropertyMatch[] = ((pursuitsRes.data ?? []) as unknown as PropertyPursuitRow[]).map(
        (p) => ({
          id: p.id,
          stage: p.stage,
          flagged_new: p.flagged_new,
          inquiry_date: p.inquiry_date,
          tenant_rep_id: p.client_id,
          tenant_company: p.client?.company ?? null,
          tenant_contact: p.client?.contact ?? null,
        }),
      )
      return {
        listings: (listingsRes.data ?? []) as unknown as PropertyListing[],
        matches,
      }
    },
  })
}

export type MatchStage = Enums<'pursuit_stage'>

export function useProperty(id: string | undefined) {
  return useQuery({
    queryKey: ['properties', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('properties').select('*').eq('id', id!).single()
      if (error) throw error
      // same county-first swap the list book does, so the detail page, its dialogs and the
      // owner card all show the situs address rather than a listing site's marketing range
      return { ...data, address: data.site_address ?? data.address, source_address: data.address }
    },
  })
}

function invalidatePropertyViews(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['properties'] })
  queryClient.invalidateQueries({ queryKey: ['property-deals'] })
}

/** On-demand county-appraiser enrichment for one property (via the edge function). */
export function useEnrichProperty() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (propertyId: string) => {
      const { data, error } = await supabase.functions.invoke('enrich-appraiser', {
        body: { property_ids: [propertyId] },
      })
      if (error) throw error
      return data as { tally?: Record<string, number>; results?: { status: string }[] }
    },
    onSuccess: () => invalidatePropertyViews(queryClient),
  })
}

export function useCreateProperty() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (values: TablesInsert<'properties'>) => {
      let v = values
      // geocode manually-entered properties so they appear on the Deal Map
      if (v.address && v.lat == null && v.lng == null) {
        const geo = await geocodeAddress(v)
        if (geo) v = { ...v, lat: geo.lat, lng: geo.lng }
      }
      const { data, error } = await supabase.from('properties').insert(v).select().single()
      if (error) throw error
      return data
    },
    onSuccess: () => invalidatePropertyViews(queryClient),
  })
}

export function useUpdateProperty() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...values }: TablesUpdate<'properties'> & { id: string }) => {
      let v = values
      // re-geocode when the address is edited and coordinates weren't set explicitly
      if (v.address && v.lat == null && v.lng == null) {
        const geo = await geocodeAddress(v)
        if (geo) v = { ...v, lat: geo.lat, lng: geo.lng }
      }
      const { data, error } = await supabase.from('properties').update(v).eq('id', id).select().single()
      if (error) throw error
      return data
    },
    onSuccess: () => invalidatePropertyViews(queryClient),
  })
}

/**
 * Replace a property's tags (the chip editor writes the whole array).
 *
 * Separate from `useUpdateProperty` because that one re-geocodes on address change and
 * carries a much wider payload; a tag edit is a one-column write that should not be
 * able to move a pin. Empty array is stored as null so "no tags" is one value, not two.
 */
export function useUpdatePropertyTags() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (v: { propertyId: string; tags: string[] }) => {
      const { error } = await supabase
        .from('properties')
        .update({ tags: v.tags.length ? v.tags : null })
        .eq('id', v.propertyId)
      if (error) throw error
    },
    onSuccess: () => invalidatePropertyViews(queryClient),
  })
}

export function useDeleteProperty() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('properties').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['properties'] }),
  })
}
