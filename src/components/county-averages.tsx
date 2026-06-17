import { Fragment, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { useAllCountyMarketStats } from '@/hooks/use-market'
import { useCountyCompTrend } from '@/hooks/use-comps'
import { TrendChart } from '@/components/trend-chart'

/** The broker's six target counties — spillover counties are hidden. */
const TARGET_COUNTIES = ['Hillsborough', 'Pinellas', 'Pasco', 'Polk', 'Manatee', 'Sarasota']
const WINDOWS = [1, 3, 5, 10]

const money = (v: number | null) => (v == null ? '—' : `$${Number(v).toFixed(2)}`)
const perSf = (v: number | null) => (v == null ? '—' : `$${Math.round(Number(v))}`)
const pct = (v: number | null) => (v == null ? '—' : `${v}%`)
const dom = (v: number | null) => (v == null ? '—' : `${v}d`)
const perAcre = (v: number | null) => {
  if (v == null) return '—'
  const n = Number(v)
  return n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : `$${Math.round(n / 1000)}K`
}
const nLabel = (v: number | null) => (v == null ? null : `n=${v}`)

function CountyTrend({ county }: { county: string }) {
  const [years, setYears] = useState(3)
  const { data, isLoading } = useCountyCompTrend(county, years)
  const buckets = data?.buckets ?? []
  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-medium text-muted-foreground">{county} comp trend</span>
        {WINDOWS.map((y) => (
          <button
            key={y}
            onClick={() => setYears(y)}
            className={cn(
              'rounded-md border px-2 py-0.5 text-xs font-medium transition-colors',
              years === y
                ? 'border-primary bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent',
            )}
          >
            {y}Y
          </button>
        ))}
      </div>
      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <TrendChart
            title="Lease asking $/SF"
            color="#2563eb"
            points={buckets.map((b) => ({ label: b.label, value: b.leaseValue, n: b.leaseN }))}
            format={(v) => `$${v.toFixed(2)}`}
          />
          <TrendChart
            title="Sale $/SF"
            color="#16a34a"
            points={buckets.map((b) => ({ label: b.label, value: b.saleValue, n: b.saleN }))}
            format={(v) => `$${Math.round(v)}`}
          />
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Blends current asking with executed comps by date — executed history fills in as you close
        lease and sale deals.
      </p>
    </div>
  )
}

/**
 * County-by-county asking-market averages (the broker's six counties), each row expanding
 * into a lease/sale comp trend over a selectable window. Driven by v_county_market_stats +
 * the comps table.
 */
export function CountyAverages() {
  const { data: rows = [], isLoading } = useAllCountyMarketStats()
  const [open, setOpen] = useState<string | null>(null)

  const visible = rows.filter((r) => r.county && TARGET_COUNTIES.includes(r.county))

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">County market averages</h2>
        <span className="text-xs text-muted-foreground">Click a county for trends</span>
      </div>
      {isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : visible.length === 0 ? (
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
              {visible.map((r) => {
                const county = r.county as string
                const isOpen = open === county
                return (
                  <Fragment key={county}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() => setOpen(isOpen ? null : county)}
                    >
                      <TableCell className="font-medium">
                        <span className="flex items-center gap-1">
                          {isOpen ? (
                            <ChevronDown className="size-3.5 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="size-3.5 text-muted-foreground" />
                          )}
                          {county}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {r.listing_n ?? '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(r.lease_median_psf)}
                        {nLabel(r.lease_n) && (
                          <span className="ml-1 text-xs text-muted-foreground">{nLabel(r.lease_n)}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {perSf(r.sale_median_psf)}
                        {nLabel(r.sale_n) && (
                          <span className="ml-1 text-xs text-muted-foreground">{nLabel(r.sale_n)}</span>
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
                    {isOpen && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={7} className="bg-muted/30 p-0">
                          <CountyTrend county={county} />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
