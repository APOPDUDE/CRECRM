import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { TablesInsert, TablesUpdate } from '@/lib/database.types'

export interface CompTrendBucket {
  label: string
  leaseAsking: number | null
  leaseExecuted: number | null
  saleAsking: number | null
  saleExecuted: number | null
}

type CompRow = {
  deal_type: string | null
  kind: string | null
  executed_at: string | null
  created_at: string
  asking_lease_rate_psf: number | null
  executed_lease_rate_psf: number | null
  sale_price: number | null
  price_per_sf: number | null
  sf: number | null
}

type Gran = 'month' | 'quarter' | 'year'

const bucketStart = (d: Date, g: Gran) =>
  g === 'month'
    ? new Date(d.getFullYear(), d.getMonth(), 1)
    : g === 'quarter'
      ? new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1)
      : new Date(d.getFullYear(), 0, 1)

const nextBucket = (d: Date, g: Gran) =>
  g === 'month'
    ? new Date(d.getFullYear(), d.getMonth() + 1, 1)
    : g === 'quarter'
      ? new Date(d.getFullYear(), d.getMonth() + 3, 1)
      : new Date(d.getFullYear() + 1, 0, 1)

const bucketLabel = (b: Date, g: Gran) =>
  g === 'month'
    ? b.toLocaleString('en-US', { month: 'short' }) + (b.getMonth() === 0 ? ` '${String(b.getFullYear()).slice(2)}` : '')
    : g === 'quarter'
      ? `Q${Math.floor(b.getMonth() / 3) + 1} '${String(b.getFullYear()).slice(2)}`
      : String(b.getFullYear())

const round2 = (v: number) => Math.round(v * 100) / 100

function bucketTrend(rows: CompRow[], years: number): { buckets: CompTrendBucket[]; granularity: Gran } {
  const granularity: Gran = years <= 1 ? 'month' : years <= 5 ? 'quarter' : 'year'
  const now = new Date()
  const winStart = bucketStart(new Date(now.getFullYear() - years, now.getMonth(), 1), granularity)

  type Acc = { label: string; la: number; lan: number; le: number; len: number; sa: number; san: number; se: number; sen: number }
  const order: string[] = []
  const map = new Map<string, Acc>()
  for (let cur = new Date(winStart); cur <= now; cur = nextBucket(cur, granularity)) {
    const k = `${cur.getFullYear()}-${cur.getMonth()}`
    order.push(k)
    map.set(k, { label: bucketLabel(cur, granularity), la: 0, lan: 0, le: 0, len: 0, sa: 0, san: 0, se: 0, sen: 0 })
  }

  for (const r of rows) {
    const dStr = r.executed_at || (r.created_at ? r.created_at.slice(0, 10) : null)
    if (!dStr) continue
    const d = new Date(`${dStr}T00:00:00`)
    if (d < winStart || d > now) continue
    const bk = bucketStart(d, granularity)
    const b = map.get(`${bk.getFullYear()}-${bk.getMonth()}`)
    if (!b) continue
    const dt = (r.deal_type || '').toLowerCase()
    const isExec = (r.kind || 'asking').toLowerCase() === 'executed'
    if (dt === 'lease' || dt === 'both') {
      const v = r.executed_lease_rate_psf ?? r.asking_lease_rate_psf
      if (v != null && Number(v) > 0) {
        if (isExec) { b.le += Number(v); b.len++ } else { b.la += Number(v); b.lan++ }
      }
    }
    if (dt === 'sale' || dt === 'both') {
      const v = r.price_per_sf ?? (r.sale_price != null && r.sf ? r.sale_price / r.sf : null)
      if (v != null && Number(v) > 0) {
        if (isExec) { b.se += Number(v); b.sen++ } else { b.sa += Number(v); b.san++ }
      }
    }
  }

  const buckets = order.map((k) => {
    const b = map.get(k)!
    return {
      label: b.label,
      leaseAsking: b.lan ? round2(b.la / b.lan) : null,
      leaseExecuted: b.len ? round2(b.le / b.len) : null,
      saleAsking: b.san ? round2(b.sa / b.san) : null,
      saleExecuted: b.sen ? round2(b.se / b.sen) : null,
    }
  })
  return { buckets, granularity }
}

export type PropertyComp = {
  id: string
  kind: string | null
  deal_type: string | null
  as_of_date: string | null
  asking_lease_rate_psf: number | null
  executed_lease_rate_psf: number | null
  lease_structure: string | null
  term_months: number | null
  free_rent_months: number | null
  ti_psf: number | null
  opex_psf: number | null
  escalations: string | null
  commencement_date: string | null
  expiration_date: string | null
  sale_price: number | null
  cap_rate_pct: number | null
  sf: number | null
  executed_at: string | null
  commission_fee: number | null
  source: string | null
  /** The comp's OWN listing identity — the only thing its listing link may be built from. */
  source_key: string | null
  tenant_name: string | null
  tenant_company_id: string | null
  pursuit_id: string | null
  pursuit: {
    actual_fee: number | null
    client: {
      company: { name: string } | null
      contact: { first_name: string; last_name: string | null } | null
    } | null
  } | null
}

/** Every comp on a property — asking + executed history — newest first. */
export function usePropertyComps(propertyId: string | undefined) {
  return useQuery({
    queryKey: ['property-comps', propertyId],
    enabled: !!propertyId,
    queryFn: async (): Promise<PropertyComp[]> => {
      const { data, error } = await supabase
        .from('comps')
        .select(
          'id, kind, deal_type, as_of_date, asking_lease_rate_psf, executed_lease_rate_psf, lease_structure, term_months, free_rent_months, ti_psf, opex_psf, escalations, commencement_date, expiration_date, sale_price, cap_rate_pct, sf, executed_at, commission_fee, source, source_key, tenant_name, tenant_company_id, pursuit_id, pursuit:pursuits!comps_pursuit_id_fkey(actual_fee, client:clients!pursuits_client_id_fkey(company:companies!clients_company_id_fkey(name), contact:contacts!clients_contact_id_fkey(first_name, last_name)))',
        )
        .eq('property_id', propertyId!)
        .in('kind', ['asking', 'executed'])
        .order('as_of_date', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as PropertyComp[]
    },
  })
}

function invalidateComps(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['property-comps'] })
  qc.invalidateQueries({ queryKey: ['county-comp-trend'] })
  qc.invalidateQueries({ queryKey: ['matches'] })
}

/** Create or update a comp on a property; mirrors the fee to the linked pursuit if any. */
export function useUpsertComp() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (comp: TablesUpdate<'comps'> & { property_id: string }) => {
      let saved: { pursuit_id: string | null; commission_fee: number | null } | null = null
      if (comp.id) {
        const { id, ...rest } = comp
        const { data, error } = await supabase
          .from('comps')
          .update({ ...rest, updated_at: new Date().toISOString() })
          .eq('id', id)
          .select('pursuit_id, commission_fee')
          .single()
        if (error) throw error
        saved = data
      } else {
        const { data, error } = await supabase
          .from('comps')
          .insert(comp as TablesInsert<'comps'>)
          .select('pursuit_id, commission_fee')
          .single()
        if (error) throw error
        saved = data
      }
      if (saved?.pursuit_id) {
        await supabase.from('pursuits').update({ actual_fee: saved.commission_fee ?? null }).eq('id', saved.pursuit_id)
      }
    },
    onSuccess: () => invalidateComps(qc),
  })
}

export function useDeleteComp() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('comps').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => invalidateComps(qc),
  })
}

/**
 * A property's current asking, pivoted from the latest asking comp per deal_type:
 * `rate` (lease $/SF), `price` (sale total), `cap` (%), `sf` (available space on the
 * current lease asking). This replaces the dropped `properties.asking_*` cache —
 * pricing/space now live only on the comps time-series, keyed by property_id.
 *
 * R7: the three LIGHT listing-event facts the list surfaces show (table columns,
 * CSV export, widget links) ride along — the asking comp IS the listing event, and
 * the matching properties.* columns are being dropped. The heavy event text
 * (brokers, title, description) stays on {@link useCurrentListingEvent}.
 */
export type CurrentAsking = {
  rate: number | null
  price: number | null
  cap: number | null
  sf: number | null
  listing_url: string | null
  days_on_market: number | null
  occupancy: string | null
}

type CurrentAskingRow = {
  property_id: string
  deal_type: string | null
  as_of_date: string | null
  asking_lease_rate_psf: number | null
  sale_price: number | null
  cap_rate_pct: number | null
  sf: number | null
  listing_url: string | null
  days_on_market: number | null
  occupancy: string | null
}

/**
 * Latest asking per property (Map keyed by property_id). Pass property ids to scope
 * the query; omit to fetch the whole table (the Properties list). Plain async fn so
 * data hooks (e.g. use-matches) can merge it into embedded property rows.
 */
// PostgREST filters ride in the GET query string (~39 bytes per uuid); a few hundred
// ids would blow proxy URL limits, so id lookups go out in chunks.
const ASKING_IDS_PER_REQUEST = 150

export async function fetchCurrentAsking(
  propertyIds?: string[],
): Promise<Map<string, CurrentAsking>> {
  const map = new Map<string, CurrentAsking>()
  const ids = propertyIds ? Array.from(new Set(propertyIds.filter(Boolean))) : undefined
  if (ids && ids.length === 0) return map
  // one literal (no concat): a computed string widens to `string` and supabase-js
  // loses the column types, so every row degrades to GenericStringError
  const select =
    'property_id, deal_type, as_of_date, asking_lease_rate_psf, sale_price, cap_rate_pct, sf, listing_url, days_on_market, occupancy'
  let rows: CurrentAskingRow[] = []
  if (ids) {
    const chunks = []
    for (let i = 0; i < ids.length; i += ASKING_IDS_PER_REQUEST) {
      chunks.push(ids.slice(i, i + ASKING_IDS_PER_REQUEST))
    }
    const results = await Promise.all(
      chunks.map((chunk) =>
        supabase.from('v_property_current_asking').select(select).in('property_id', chunk),
      ),
    )
    for (const { data, error } of results) {
      if (error) throw error
      rows = rows.concat((data ?? []) as CurrentAskingRow[])
    }
  } else {
    // Whole-view fetch (the book): PAGE it. The view is past PostgREST's silent
    // 1000-row cap (one asking row per property x deal_type), so a single select
    // quietly truncated — pricing and listing URLs just vanished for the tail of
    // the alphabet. Ordered by property_id so pages can't interleave a property.
    const PAGE = 1000
    for (let off = 0; ; off += PAGE) {
      const { data, error } = await supabase
        .from('v_property_current_asking')
        .select(select)
        .order('property_id')
        .order('deal_type')
        .range(off, off + PAGE - 1)
      if (error) throw error
      rows = rows.concat((data ?? []) as CurrentAskingRow[])
      if ((data ?? []).length < PAGE) break
    }
  }
  // A property holds at most one row per deal_type; the NEWER event's listing facts
  // win, the older row only fills what the newer left null (same rule as
  // useCurrentListingEvent). Sort here — chunked requests arrive unordered.
  rows.sort((a, b) =>
    a.property_id === b.property_id
      ? (b.as_of_date ?? '').localeCompare(a.as_of_date ?? '')
      : a.property_id.localeCompare(b.property_id),
  )
  for (const r of rows) {
    const cur =
      map.get(r.property_id) ??
      ({
        rate: null,
        price: null,
        cap: null,
        sf: null,
        listing_url: null,
        days_on_market: null,
        occupancy: null,
      } as CurrentAsking)
    if (r.deal_type === 'lease') {
      if (r.asking_lease_rate_psf != null) cur.rate = r.asking_lease_rate_psf
      if (r.sf != null) cur.sf = r.sf
    } else if (r.deal_type === 'sale') {
      if (r.sale_price != null) cur.price = r.sale_price
    }
    if (r.cap_rate_pct != null && cur.cap == null) cur.cap = r.cap_rate_pct
    if (r.listing_url != null && cur.listing_url == null) cur.listing_url = r.listing_url
    if (r.days_on_market != null && cur.days_on_market == null) cur.days_on_market = r.days_on_market
    if (r.occupancy != null && cur.occupancy == null) cur.occupancy = r.occupancy
    map.set(r.property_id, cur)
  }
  return map
}

/**
 * React-Query wrapper around {@link fetchCurrentAsking} for components. The id list is
 * part of the key, so accepting/dismissing a suggestion changes it — keepPreviousData
 * holds the old map on screen instead of blanking every metric during the refetch.
 */
export function useCurrentAsking(propertyIds?: string[]) {
  const ids = propertyIds
    ? Array.from(new Set(propertyIds.filter(Boolean))).sort()
    : undefined
  return useQuery({
    queryKey: ['current-asking', ids ?? 'all'],
    enabled: ids ? ids.length > 0 : true,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: () => fetchCurrentAsking(ids),
    placeholderData: keepPreviousData,
  })
}

/**
 * R7: the listing-event half of the current asking. The latest asking comp IS
 * the listing-event record (url, broker, dates, sale terms), so single-property
 * surfaces (property page, preview) read these from `v_property_current_asking`
 * and fall back to the matching properties.* columns until those drop. Kept
 * separate from {@link fetchCurrentAsking} so whole-book callers never pay for
 * listing_description-sized text on thousands of rows.
 */
export type CurrentListingEvent = {
  listing_url: string | null
  broker_name: string | null
  broker_company: string | null
  broker_phone: string | null
  broker_email: string | null
  days_on_market: number | null
  listed_at: string | null
  listing_title: string | null
  listing_description: string | null
  sale_conditions: string | null
  sale_status: string | null
  sale_type: string | null
  is_auction: boolean | null
  occupancy: string | null
  source_last_updated: string | null
}

const EVENT_KEYS = [
  'listing_url',
  'broker_name',
  'broker_company',
  'broker_phone',
  'broker_email',
  'days_on_market',
  'listed_at',
  'listing_title',
  'listing_description',
  'sale_conditions',
  'sale_status',
  'sale_type',
  'is_auction',
  'occupancy',
  'source_last_updated',
] as const

/** Latest listing-event fields for one property, newest asking comp first. */
export function useCurrentListingEvent(propertyId: string | undefined) {
  return useQuery({
    queryKey: ['current-listing-event', propertyId],
    enabled: !!propertyId,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<CurrentListingEvent | null> => {
      const { data, error } = await supabase
        .from('v_property_current_asking')
        .select(`as_of_date, ${EVENT_KEYS.join(', ')}`)
        .eq('property_id', propertyId!)
        .order('as_of_date', { ascending: false, nullsFirst: false })
      if (error) throw error
      const rows = (data ?? []) as unknown as (CurrentListingEvent & {
        as_of_date: string | null
      })[]
      if (rows.length === 0) return null
      // The view holds one row per deal_type (a property can carry a current
      // lease AND a current sale asking). The newest event's fields win; the
      // other row only fills what the newest left null.
      return Object.fromEntries(
        EVENT_KEYS.map((k) => [k, rows.map((r) => r[k]).find((v) => v != null) ?? null]),
      ) as CurrentListingEvent
    },
  })
}

/** Lease $/SF and sale $/SF comp trend for a county over the last `years` years. */
export function useCountyCompTrend(county: string | null, years: number) {
  return useQuery({
    queryKey: ['county-comp-trend', county, years],
    enabled: !!county,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('comps')
        .select(
          'deal_type, kind, executed_at, created_at, asking_lease_rate_psf, executed_lease_rate_psf, sale_price, price_per_sf, sf, properties!inner(county)',
        )
        .eq('properties.county', county!)
        .in('kind', ['asking', 'executed'])
      if (error) throw error
      return bucketTrend((data ?? []) as unknown as CompRow[], years)
    },
  })
}
