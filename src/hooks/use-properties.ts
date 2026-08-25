import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchPages } from '@/lib/paged-fetch'
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
  | 'year_built' | 'zoning_description' | 'zoning_district'
  | 'lat' | 'lng' | 'owner_company_id' | 'owner_name' | 'owner_mailing_address'
  | 'last_sale_date' | 'last_sale_price' | 'created_at' | 'updated_at'
  | 'zoning_type' | 'zoning_code' | 'zoning_jurisdiction' | 'dor_use_code'
  | 'is_condo_unit' | 'in_land_book' | 'land_only'
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
  /**
   * Developer suitability, 0-100, from parcel_enrichment. Null means one of two
   * different things and the UI has to keep them apart: the enrichment pass has
   * not reached this parcel, or it has and score_parcels withheld the number
   * because too few factors were measured to publish one honestly. Either way
   * there is nothing to sort on — the detail card explains which.
   */
  suitability_score: number | null
}

/** Total linked deals on a property: landlord listings + tenant pursuits. */
export function dealCount(p: Pick<PropertyWithCounts, 'listings' | 'matches'>): number {
  return (p.listings?.[0]?.count ?? 0) + (p.matches?.[0]?.count ?? 0)
}

/**
 * Which book a read wants. 'industrial' is the normal War Room (land_only rows
 * excluded — "just land" lives only on the land book, Alex 2026-08-21);
 * 'land' is the land book (in_land_book, which includes the <=5%-ratio
 * crossovers that appear on BOTH); 'all' is everything (autofill, dedupe —
 * askers that care about existence, not canvassing).
 */
export type PropertyBook = 'industrial' | 'land' | 'all'

/**
 * The whole book, paged in parallel.
 *
 * `enabled` exists because this is expensive — tens of thousands of rows, and every
 * consumer that mounts it pays for all of them. The map no longer does: it loads by
 * viewport (see {@link import('./use-map-properties').useMapProperties}) and only
 * reaches for the book when a search or filter asks a question about properties that
 * aren't on screen. `book` filters SERVER-side so the industrial book never pays for
 * the land rows (the reason the land book exists as a separate thing at all).
 */
export function useProperties(enabled = true, book: PropertyBook = 'all') {
  return useQuery({
    queryKey: ['properties', book],
    enabled,
    // The book is ~13k rows: refetching it on every mount made returning to the map feel
    // frozen. Cache for 5 minutes (mutations invalidate explicitly), don't refetch on
    // window focus, and fetch the pages IN PARALLEL (serial paging was 14 round-trips).
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const PAGE = 1000
      // days_on_market / occupancy / listing_url left this select (R7): they are
      // listing-EVENT facts and now ride on the current asking comp — the pages that
      // showed them read the CurrentAsking map instead.
      const SELECT =
        'id, address, city, state, zip, county, parcel_number, site_address, folio, ' +
        'property_type, gross_sf, ' +
        'land_acres, specs, listing_status, year_built, zoning_description, ' +
        'zoning_district, lat, lng, owner_company_id, owner_name, owner_mailing_address, ' +
        'last_sale_date, last_sale_price, created_at, updated_at, ' +
        'zoning_type, zoning_code, zoning_jurisdiction, dor_use_code, is_condo_unit, ' +
        'in_land_book, land_only'
      // The linked-deal counts used to ride as embedded `(count)` aggregates — two
      // correlated subqueries evaluated per book row to tally what is (2026-08-16)
      // 10 listings + 176 pursuits in total. Fetching the deal tables' property_ids
      // outright and counting client-side takes the same information for two tiny
      // requests instead of ~64 heavyweight pages.
      const dealIds = async (table: 'listings' | 'pursuits') => {
        const ids: (string | null)[] = []
        for (let off = 0; ; off += PAGE) {
          const r = await supabase.from(table).select('property_id').range(off, off + PAGE - 1)
          if (r.error) throw r.error
          ids.push(...(r.data ?? []).map((x) => x.property_id))
          if ((r.data ?? []).length < PAGE) break
        }
        const m = new Map<string, number>()
        for (const id of ids) if (id) m.set(id, (m.get(id) ?? 0) + 1)
        return m
      }
      // Suitability rides the same shape as the deal counts: one paged id+number
      // fetch merged client-side, rather than an embedded lateral evaluated once
      // per book row. parcel_enrichment is keyed by property_id, so this is a
      // single index scan per page.
      const scores = async () => {
        const m = new Map<string, number>()
        for (let off = 0; ; off += PAGE) {
          const r = await supabase
            .from('parcel_enrichment')
            .select('property_id, suitability_score')
            .not('suitability_score', 'is', null)
            .range(off, off + PAGE - 1)
          if (r.error) throw r.error
          for (const x of r.data ?? []) {
            if (x.suitability_score !== null) m.set(x.property_id, Number(x.suitability_score))
          }
          if ((r.data ?? []).length < PAGE) break
        }
        return m
      }
      // Page by UUID RANGE on the PK, never by OFFSET-over-a-sort: ordering by
      // (address, id) has no index, so every deep page re-sorted the whole table —
      // measured 5s a page on 2026-08-16 (post-UPDATE-churn bloat), close enough to
      // the 8s statement timeout that pages 500 under parallel load and the whole
      // book fetch dies. Ids are gen_random_uuid() (uniform), so fixed id-space
      // buckets are ~equal pages, each a pure index range scan. Pooled + per-page
      // retry as before; the address sort happens client-side at the end.
      const BUCKETS = 64
      const bound = (i: number) =>
        `${(i * 4).toString(16).padStart(2, '0')}000000-0000-0000-0000-000000000000`
      const bucketQuery = (i: number) => {
        let q = supabase
          .from('properties')
          .select(SELECT)
          // hide scrape placeholders that aren't real addresses — no coords/parcel/deals.
          .not('address', 'ilike', '%unavailable%')
          .not('address', 'ilike', 'Portfolio of %')
          .order('id')
          .gte('id', bound(i))
        // book filter is server-side: the industrial book must not fetch (or pay for)
        // the land rows, and vice versa
        if (book === 'industrial') q = q.eq('land_only', false)
        if (book === 'land') q = q.eq('in_land_book', true)
        if (i < BUCKETS - 1) q = q.lt('id', bound(i + 1))
        return q
      }
      type BucketRow = Omit<PropertyWithCounts, 'listings' | 'matches' | 'source_address'>
      const [listingCounts, pursuitCounts, scoreById, ...pages] = await Promise.all([
        dealIds('listings'),
        dealIds('pursuits'),
        scores(),
        fetchPages(BUCKETS, async (i) => {
          const r = await bucketQuery(i).limit(PAGE)
          if (r.error) throw r.error
          let rows = (r.data ?? []) as unknown as BucketRow[]
          // a full page = the bucket hit the cap (~500 expected): keyset-continue in it
          while (rows.length > 0 && rows.length % PAGE === 0) {
            const r2 = await bucketQuery(i).gt('id', rows[rows.length - 1].id).limit(PAGE)
            if (r2.error) throw r2.error
            const more = (r2.data ?? []) as unknown as BucketRow[]
            if (more.length === 0) break
            rows = rows.concat(more)
          }
          return rows
        }),
      ] as const)
      const all = pages.flat().flat()
      // County records are the source of truth (Alex 2026-08-11), so the situs address is what
      // the whole app shows, searches, maps and exports — one swap here rather than a
      // `site_address ?? address` at every read site. The original stays on source_address.
      // Sorted by the displayed address (the server used to do this; buckets arrive by id).
      return all
        .map((p) => ({
          ...p,
          address: p.site_address ?? p.address,
          source_address: p.address,
          listings: [{ count: listingCounts.get(p.id) ?? 0 }],
          matches: [{ count: pursuitCounts.get(p.id) ?? 0 }],
          suitability_score: scoreById.get(p.id) ?? null,
        }))
        .sort((a, b) => (a.address ?? '').localeCompare(b.address ?? '')) as PropertyWithCounts[]
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
/**
 * ONE PAGE of the land book, straight from the server, in address order.
 *
 * The plain land-book table (no search, no filters) was downloading the whole
 * 100k-row book to render 100 rows (Alex 2026-08-24: "taking forever again...
 * it should be the normal list"). This serves exactly the visible page plus an
 * exact count; the whole-book fetch now runs only when something genuinely
 * needs whole-book answers — a filter Apply, a search, Export, Review.
 * Ordered by properties_land_book_address_idx, so it stays an index scan.
 */
export function usePagedLandBook(page: number, enabled = true) {
  return useQuery({
    queryKey: ['land-book-page', page],
    enabled,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const SELECT =
        'id, address, city, state, zip, county, parcel_number, site_address, folio, ' +
        'property_type, gross_sf, ' +
        'land_acres, specs, listing_status, year_built, zoning_description, ' +
        'zoning_district, lat, lng, owner_company_id, owner_name, owner_mailing_address, ' +
        'last_sale_date, last_sale_price, created_at, updated_at, ' +
        'zoning_type, zoning_code, zoning_jurisdiction, dor_use_code, is_condo_unit, ' +
        'in_land_book, land_only'
      const PAGE = 100
      const from = page * PAGE
      const { data, error, count } = await supabase
        .from('properties')
        .select(SELECT, { count: 'exact' })
        .eq('in_land_book', true)
        .not('address', 'ilike', '%unavailable%')
        .not('address', 'ilike', 'Portfolio of %')
        .order('address')
        .range(from, from + PAGE - 1)
      if (error) throw error
      const rows = (data ?? []).map((r) => ({
        ...(r as unknown as Property),
        source_address: (r as { address: string | null }).address,
        listings: [], matches: [], suitability_score: null,
      })) as PropertyWithCounts[]
      return { rows, total: count ?? rows.length }
    },
  })
}

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
