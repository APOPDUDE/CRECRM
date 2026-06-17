import { TrendingDown, TrendingUp } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useCountyMarketStats, usePropertyMarketPosition } from '@/hooks/use-market'

/** $605K, $1.2M — compact dollars for $/acre and totals. */
function compactUsd(value: number | null | undefined): string | null {
  if (value == null) return null
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`
  return `$${Math.round(value)}`
}

const psf = (v: number | null | undefined) => (v == null ? null : `$${Number(v).toFixed(2)} PSF`)
const perSf = (v: number | null | undefined) => (v == null ? null : `$${Math.round(Number(v))}/SF`)
const perAcre = (v: number | null | undefined) => (v == null ? null : `${compactUsd(Number(v))}/AC`)

/** A "this property vs county median" comparison line, color-coded for the broker's side. */
function PositionRow({
  label,
  value,
  median,
  pct,
  good,
  format,
}: {
  label: string
  value: number | null
  median: number | null
  pct: number | null
  good: boolean
  format: (v: number | null | undefined) => string | null
}) {
  if (value == null) return null
  const below = pct != null && pct < 0
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        <div className="text-sm font-semibold">{format(value)}</div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {median != null && (
          <span className="text-xs text-muted-foreground">mkt {format(median)}</span>
        )}
        {pct != null ? (
          <span
            className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium ${
              good
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : below
                  ? 'border-gray-200 bg-gray-50 text-gray-600'
                  : 'border-amber-200 bg-amber-50 text-amber-700'
            }`}
          >
            {below ? <TrendingDown className="size-3" /> : <TrendingUp className="size-3" />}
            {Math.abs(pct)}% {below ? 'below' : 'above'}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">no baseline</span>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string | null; sub?: string | null }) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 text-sm font-semibold ${value == null ? 'font-normal text-muted-foreground' : ''}`}>
        {value ?? '—'}
        {value != null && sub && <span className="ml-1 text-xs font-normal text-muted-foreground">{sub}</span>}
      </dd>
    </div>
  )
}

/**
 * County market dashboard + this property's position within it. Baselines come from
 * every other property in the database, county by county (see v_county_market_stats /
 * v_property_market_position).
 */
export function MarketPositionCard({
  propertyId,
  county,
}: {
  propertyId: string
  county: string | null
}) {
  const { data: pos, isLoading: posLoading } = usePropertyMarketPosition(propertyId)
  const { data: stats, isLoading: statsLoading } = useCountyMarketStats(county)

  if (!county) return null
  if (posLoading || statsLoading) {
    return <Skeleton className="h-44 w-full max-w-2xl" />
  }
  if (!stats) return null

  const anyGood = !!(pos && (pos.good_lease_deal || pos.good_sale_deal))
  const hasPosition =
    pos && (pos.asking_rate_psf != null || pos.sale_psf != null || pos.land_per_acre != null)
  const n = (v: number | null) => (v != null ? `n=${v}` : null)

  return (
    <div className="max-w-2xl space-y-4 rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{county} County market</h2>
        {anyGood && (
          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 font-medium text-emerald-700">
            {pos?.good_lease_deal && pos?.good_sale_deal
              ? 'Good lease & sale deal'
              : pos?.good_lease_deal
                ? 'Good lease deal'
                : 'Good sale deal'}
          </Badge>
        )}
      </div>

      {/* This property vs the county market */}
      {hasPosition && (
        <div className="divide-y rounded-lg border bg-background px-3">
          <PositionRow
            label="Lease rate"
            value={pos?.asking_rate_psf ?? null}
            median={pos?.lease_baseline_median ?? null}
            pct={pos?.lease_vs_market_pct ?? null}
            good={!!pos?.good_lease_deal}
            format={psf}
          />
          <PositionRow
            label="Sale price"
            value={pos?.sale_psf ?? null}
            median={pos?.sale_baseline_median ?? null}
            pct={pos?.sale_vs_market_pct ?? null}
            good={!!pos?.good_sale_deal}
            format={perSf}
          />
          <PositionRow
            label="Land price"
            value={pos?.land_per_acre ?? null}
            median={pos?.land_baseline_median ?? null}
            pct={pos?.land_vs_market_pct ?? null}
            good={false}
            format={perAcre}
          />
        </div>
      )}

      {/* County-wide baseline dashboard */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <Stat label="Median lease" value={psf(stats.lease_median_psf)} sub={n(stats.lease_n)} />
        <Stat
          label="Lease range"
          value={
            stats.lease_p25_psf != null && stats.lease_p75_psf != null
              ? `${psf(stats.lease_p25_psf)} – ${psf(stats.lease_p75_psf)}`
              : null
          }
        />
        <Stat label="Median sale" value={perSf(stats.sale_median_psf)} sub={n(stats.sale_n)} />
        <Stat
          label="Avg cap rate"
          value={stats.sale_avg_cap != null ? `${stats.sale_avg_cap}%` : null}
          sub={n(stats.sale_cap_n)}
        />
        <Stat label="Median land" value={perAcre(stats.land_median_per_acre)} sub={n(stats.land_n)} />
        <Stat
          label="Avg days on mkt"
          value={stats.avg_dom != null ? `${stats.avg_dom} days` : null}
          sub={stats.listing_n != null ? `${stats.listing_n} listings` : null}
        />
      </dl>
    </div>
  )
}
