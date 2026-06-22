import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

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
  deal_type: string | null
  executed_lease_rate_psf: number | null
  lease_structure: string | null
  term_months: number | null
  free_rent_months: number | null
  ti_psf: number | null
  escalations: string | null
  commencement_date: string | null
  expiration_date: string | null
  sale_price: number | null
  cap_rate_pct: number | null
  sf: number | null
  executed_at: string | null
  pursuit: {
    actual_fee: number | null
    client: {
      company: { name: string } | null
      contact: { first_name: string; last_name: string | null } | null
    } | null
  } | null
}

/** Executed (closed-deal) comps recorded on a property — the actual lease/sale terms + booked fee. */
export function usePropertyComps(propertyId: string | undefined) {
  return useQuery({
    queryKey: ['property-comps', propertyId],
    enabled: !!propertyId,
    queryFn: async (): Promise<PropertyComp[]> => {
      const { data, error } = await supabase
        .from('comps')
        .select(
          'id, deal_type, executed_lease_rate_psf, lease_structure, term_months, free_rent_months, ti_psf, escalations, commencement_date, expiration_date, sale_price, cap_rate_pct, sf, executed_at, pursuit:pursuits!comps_pursuit_id_fkey(actual_fee, client:clients!pursuits_client_id_fkey(company:companies!clients_company_id_fkey(name), contact:contacts!clients_contact_id_fkey(first_name, last_name)))',
        )
        .eq('property_id', propertyId!)
        .eq('kind', 'executed')
        .order('executed_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as PropertyComp[]
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
      if (error) throw error
      return bucketTrend((data ?? []) as unknown as CompRow[], years)
    },
  })
}
