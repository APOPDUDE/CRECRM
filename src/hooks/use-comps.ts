import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export interface CompTrendBucket {
  label: string
  leaseValue: number | null
  leaseN: number
  saleValue: number | null
  saleN: number
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

  const order: string[] = []
  const map = new Map<string, { label: string; ls: number; ln: number; ss: number; sn: number }>()
  for (let cur = new Date(winStart); cur <= now; cur = nextBucket(cur, granularity)) {
    const k = `${cur.getFullYear()}-${cur.getMonth()}`
    order.push(k)
    map.set(k, { label: bucketLabel(cur, granularity), ls: 0, ln: 0, ss: 0, sn: 0 })
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
    if (dt === 'lease' || dt === 'both') {
      const v = r.executed_lease_rate_psf ?? r.asking_lease_rate_psf
      if (v != null && Number(v) > 0) {
        b.ls += Number(v)
        b.ln++
      }
    }
    if (dt === 'sale' || dt === 'both') {
      const v = r.price_per_sf ?? (r.sale_price != null && r.sf ? r.sale_price / r.sf : null)
      if (v != null && Number(v) > 0) {
        b.ss += Number(v)
        b.sn++
      }
    }
  }

  const buckets = order.map((k) => {
    const b = map.get(k)!
    return {
      label: b.label,
      leaseValue: b.ln ? round2(b.ls / b.ln) : null,
      leaseN: b.ln,
      saleValue: b.sn ? round2(b.ss / b.sn) : null,
      saleN: b.sn,
    }
  })
  return { buckets, granularity }
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
