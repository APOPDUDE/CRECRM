import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useAllCountyMarketStats } from '@/hooks/use-market'

const money = (v: number | null) => (v == null ? '—' : `$${Number(v).toFixed(2)}`)
const perSf = (v: number | null) => (v == null ? '—' : `$${Math.round(Number(v))}`)
const pct = (v: number | null) => (v == null ? '—' : `${v}%`)
const dom = (v: number | null) => (v == null ? '—' : `${v}d`)
const perAcre = (v: number | null) => {
  if (v == null) return '—'
  const n = Number(v)
  return n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : `$${Math.round(n / 1000)}K`
}
const n = (v: number | null) => (v == null ? null : `n=${v}`)

/**
 * County-by-county asking-market averages, drawn from the same baselines that power
 * the property page's market position (v_county_market_stats).
 */
export function CountyAverages() {
  const { data: rows = [], isLoading } = useAllCountyMarketStats()

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">County market averages</h2>
        <span className="text-xs text-muted-foreground">Asking, from scraped listings</span>
      </div>
      {isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
          No county data yet — the weekly sweep populates this.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>County</TableHead>
                <TableHead className="text-right">Listings</TableHead>
                <TableHead className="text-right">Lease&nbsp;$/SF</TableHead>
                <TableHead className="text-right">Sale&nbsp;$/SF</TableHead>
                <TableHead className="text-right">Avg&nbsp;cap</TableHead>
                <TableHead className="text-right">Land&nbsp;$/AC</TableHead>
                <TableHead className="text-right">Avg&nbsp;DOM</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.county ?? 'unknown'}>
                  <TableCell className="font-medium">{r.county ?? '—'}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {r.listing_n ?? '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(r.lease_median_psf)}
                    {n(r.lease_n) && (
                      <span className="ml-1 text-xs text-muted-foreground">{n(r.lease_n)}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {perSf(r.sale_median_psf)}
                    {n(r.sale_n) && (
                      <span className="ml-1 text-xs text-muted-foreground">{n(r.sale_n)}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{pct(r.sale_avg_cap)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {perAcre(r.land_median_per_acre)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {dom(r.avg_dom)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
