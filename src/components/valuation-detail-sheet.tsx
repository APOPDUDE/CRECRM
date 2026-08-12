import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfidenceBadge } from '@/components/value-estimate-card'
import { useCountyMarketStats } from '@/hooks/use-market'
import {
  estimatedAnnualTax,
  usePropertyValuation,
  useResetValuationComps,
  useSetCountyMillage,
  useToggleValuationComp,
  type PropertyValuation,
  type ValuationBucket,
  type ValuationComp,
} from '@/hooks/use-valuation'
import { compactUsd, formatCurrency, formatSf } from '@/lib/format'
import { formatDate } from '@/lib/dates'

const bucketTitles: Record<ValuationBucket, string> = {
  sale: 'Sale comps',
  lease: 'Lease comps',
  land: 'Land comps',
}

/** $14.05 for a rate, $605K for a land price — one formatter, keyed by bucket. */
function rateLabel(bucket: ValuationBucket, v: number | null | undefined): string {
  if (v == null) return '—'
  return bucket === 'land' ? `${compactUsd(v)}/AC` : `$${v.toFixed(2)}`
}

function CompRow({
  comp,
  onToggle,
  disabled,
}: {
  comp: ValuationComp
  onToggle: (include: boolean) => void
  disabled: boolean
}) {
  const facts = [
    comp.bucket === 'land' ? (comp.acres ? `${comp.acres} ac` : null) : formatSf(comp.sf),
    comp.miles != null ? `${comp.miles} mi` : null,
    formatDate(comp.comp_date),
    comp.tenant_name,
    comp.lease_structure,
    comp.term_months ? `${comp.term_months} mo` : null,
    comp.cap_rate_pct != null ? `${comp.cap_rate_pct}% cap` : null,
    comp.bucket === 'sale' && comp.sale_price != null ? formatCurrency(comp.sale_price) : null,
  ].filter(Boolean)

  return (
    <li className={`flex items-start gap-3 p-3 ${comp.included ? '' : 'bg-muted/40'}`}>
      <Checkbox
        className="mt-0.5"
        checked={comp.included}
        disabled={disabled}
        onCheckedChange={(v) => onToggle(v === true)}
        aria-label={comp.included ? 'Exclude this comp' : 'Include this comp'}
      />
      {/* Stacked on a phone: side by side, the rate column squeezes the address
          down to an ellipsis and wraps the facts to six lines. */}
      <div
        className={`flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3 ${
          comp.included ? '' : 'opacity-55'
        }`}
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {/* Clicking through to the comp property is the point of showing it:
                a rate you can't go look at is a rate you can't argue with. */}
            <Link
              to={`/properties/${comp.property_id}`}
              className="text-sm font-medium hover:text-primary hover:underline"
            >
              {comp.address ?? 'Unknown address'}
            </Link>
            <Badge
              variant="outline"
              className={
                comp.kind === 'executed'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-blue-200 bg-blue-50 text-blue-700'
              }
            >
              {comp.kind === 'executed' ? 'Executed' : 'Asking'}
            </Badge>
            {comp.property_type && comp.property_type !== 'industrial' && (
              <Badge variant="outline" className="border-gray-200 bg-gray-50 text-gray-600">
                {comp.property_type}
              </Badge>
            )}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">{facts.join(' · ') || '—'}</div>
        </div>
        <div className="shrink-0 sm:text-right">
          <div className="text-sm font-semibold tabular-nums">
            {comp.size_adj != null && Math.abs(comp.size_adj - 1) > 0.005 ? (
              <>
                <span className="font-normal text-muted-foreground line-through">
                  {rateLabel(comp.bucket, comp.metric)}
                </span>{' '}
                {rateLabel(comp.bucket, comp.adj_metric)}
              </>
            ) : (
              rateLabel(comp.bucket, comp.adj_metric)
            )}
          </div>
          <div className="text-xs text-muted-foreground tabular-nums">
            {comp.included ? `${comp.weight_pct ?? 0}% of estimate` : 'excluded'}
          </div>
        </div>
      </div>
    </li>
  )
}

function BucketSection({
  bucket,
  val,
  propertyId,
}: {
  bucket: ValuationBucket
  val: PropertyValuation
  propertyId: string
}) {
  const toggle = useToggleValuationComp()
  const comps = val.comps.filter((c) => c.bucket === bucket)
  if (comps.length === 0) return null

  const stats = bucket === 'sale' ? val.sale : bucket === 'lease' ? val.lease : val.land
  const included = comps.filter((c) => c.included).length
  const sf = val.subject.sf
  const acres = val.subject.land_acres

  // The one line that says how the headline was built, in the broker's units.
  let mathLine: string | null = null
  if (bucket === 'lease' && val.lease && sf) {
    mathLine = `$${val.lease.psf.toFixed(2)} PSF × ${sf.toLocaleString('en-US')} SF ÷ 12 = ${formatCurrency(val.lease.monthly)}/mo`
  } else if (bucket === 'sale' && val.sale && sf) {
    mathLine = `$${val.sale.psf.toFixed(2)} /SF × ${sf.toLocaleString('en-US')} SF = ${formatCurrency(val.sale.total)}`
  } else if (bucket === 'land' && val.land && acres) {
    mathLine = `${compactUsd(val.land.per_acre)}/AC × ${acres} acres = ${formatCurrency(val.land.total)}`
  }

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {bucketTitles[bucket]}{' '}
          <span className="font-normal text-muted-foreground">
            ({included} of {comps.length} in use
            {stats?.n_executed ? `, ${stats.n_executed} executed` : ''})
          </span>
        </h3>
        <ConfidenceBadge confidence={stats?.confidence} />
      </div>
      {mathLine && (
        <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <span className="font-medium">Weighted median</span> {mathLine}
        </p>
      )}
      <ul className="divide-y overflow-hidden rounded-lg border">
        {comps.map((c) => (
          <CompRow
            key={c.comp_id}
            comp={c}
            disabled={toggle.isPending}
            onToggle={(include) =>
              toggle.mutate(
                { propertyId, compId: c.comp_id, include },
                { onError: () => toast.error('Could not update the comp set') },
              )
            }
          />
        ))}
      </ul>
    </section>
  )
}

/** Millage is the one input we can't derive — let the broker fix it in place. */
function TaxSection({ val }: { val: PropertyValuation }) {
  const setMillage = useSetCountyMillage()
  // The draft is seeded when the field opens, not mirrored from props — the
  // rate only matters while it is being edited.
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const tax = val.tax

  if (!tax) return null
  const annual = estimatedAnnualTax(tax)

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">Estimated taxes</h3>
      <div className="space-y-2 rounded-lg border p-3 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-muted-foreground">Value the tax is figured on</span>
          <span className="font-medium tabular-nums">{formatCurrency(tax.basis) ?? '—'}</span>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-muted-foreground">
            {tax.county ?? 'County'} millage
            <span className="ml-1 text-xs">({tax.rate_pct}%)</span>
          </span>
          {editing ? (
            <span className="flex items-center gap-1">
              <Input
                className="h-8 w-24 text-right"
                value={draft}
                autoFocus
                onChange={(e) => setDraft(e.target.value)}
              />
              <Button
                size="sm"
                disabled={setMillage.isPending}
                onClick={() => {
                  const n = Number(draft)
                  if (!Number.isFinite(n) || n <= 0 || n >= 100) {
                    toast.error('Enter a millage between 0 and 100')
                    return
                  }
                  setMillage.mutate(
                    { county: tax.county ?? '', state: 'FL', millage: n },
                    {
                      onSuccess: () => {
                        toast.success(`${tax.county} millage set to ${n}`)
                        setEditing(false)
                      },
                      onError: () => toast.error('Could not save the millage'),
                    },
                  )
                }}
              >
                Save
              </Button>
            </span>
          ) : (
            <button
              type="button"
              className="font-medium tabular-nums hover:text-primary hover:underline"
              onClick={() => {
                setDraft(String(tax.millage))
                setEditing(true)
              }}
              disabled={!tax.county}
              title={tax.county ? 'Correct this rate for the whole county' : undefined}
            >
              {tax.millage} mills
            </button>
          )}
        </div>
        <div className="flex items-baseline justify-between gap-3 border-t pt-2">
          <span className="font-medium">Estimated annual tax</span>
          <span className="font-semibold tabular-nums">{formatCurrency(annual) ?? '—'}</span>
        </div>
        {tax.assessed_value != null && (
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-muted-foreground">
              Today's bill on the {formatCurrency(tax.assessed_value)} assessed value
            </span>
            <span className="tabular-nums">{formatCurrency(tax.current_annual) ?? '—'}</span>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {tax.source === 'broker'
            ? 'Rate entered by hand.'
            : 'Approximate aggregate millage — a Florida sale resets just value near market, so this is the bill a buyer inherits, not the seller’s. Click the rate to correct it.'}
        </p>
      </div>
    </section>
  )
}

/** The county baselines the old market card used to show — context, not headline. */
function CountyContext({ county }: { county: string | null }) {
  const { data: stats } = useCountyMarketStats(county)
  if (!county || !stats) return null
  const psf = (v: number | null) => (v == null ? '—' : `$${Number(v).toFixed(2)}`)
  const rows: [string, string][] = [
    ['Median lease', `${psf(stats.lease_median_psf)} PSF${stats.lease_n ? ` (n=${stats.lease_n})` : ''}`],
    [
      'Lease range',
      stats.lease_p25_psf != null && stats.lease_p75_psf != null
        ? `${psf(stats.lease_p25_psf)} – ${psf(stats.lease_p75_psf)} PSF`
        : '—',
    ],
    ['Median sale', `${psf(stats.sale_median_psf)} /SF${stats.sale_n ? ` (n=${stats.sale_n})` : ''}`],
    ['Avg cap rate', stats.sale_avg_cap != null ? `${stats.sale_avg_cap}%` : '—'],
    ['Median land', stats.land_median_per_acre != null ? `${compactUsd(stats.land_median_per_acre)}/AC` : '—'],
    ['Avg days on market', stats.avg_dom != null ? `${stats.avg_dom} days` : '—'],
  ]
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{county} County, all property</h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border p-3 text-sm sm:grid-cols-3">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/**
 * The math behind the estimate. Every comp that fed a number, what it weighs,
 * and a checkbox to throw it out — the estimate recomputes in Postgres and the
 * exclusion sticks to the property.
 */
export function ValuationDetailSheet({
  propertyId,
  open,
  onOpenChange,
}: {
  propertyId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { data: val, isLoading, isFetching } = usePropertyValuation(open ? propertyId : null)
  const reset = useResetValuationComps()

  const excludedCount = val?.comps.filter((c) => !c.included).length ?? 0

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* The variant has to match the base class's own selector or Tailwind's
          merge leaves both and the narrower data-[side=right]:sm:max-w-sm wins. */}
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 data-[side=right]:sm:max-w-3xl">
        <SheetHeader className="sticky top-0 z-10 border-b bg-popover px-4 py-3">
          <SheetTitle>How this estimate was built</SheetTitle>
          <SheetDescription>
            {val?.subject.address ?? 'Property'}
            {val?.subject.sf ? ` · ${formatSf(val.subject.sf)}` : ''}
            {val?.subject.year_built ? ` · built ${val.subject.year_built}` : ''}
          </SheetDescription>
        </SheetHeader>

        {isLoading || !val ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <div className={`space-y-6 p-4 ${isFetching ? 'opacity-60 transition-opacity' : ''}`}>
            <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
              Every comp below is weighted by how close it is, how near in size, how recent it is, and
              whether it's a signed deal rather than an asking price. Its rate is then restated at this
              building's size, and the estimate is the weighted median — so one outlier can't carry it.
              Untick anything that doesn't fit and the numbers redo themselves.
            </p>

            <BucketSection bucket="sale" val={val} propertyId={propertyId} />
            <BucketSection bucket="lease" val={val} propertyId={propertyId} />
            <BucketSection bucket="land" val={val} propertyId={propertyId} />

            <TaxSection val={val} />
            <CountyContext county={val.subject.county} />

            {excludedCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                disabled={reset.isPending}
                onClick={() =>
                  reset.mutate(propertyId, {
                    onSuccess: () => toast.success('All comps restored'),
                    onError: () => toast.error('Could not restore the comps'),
                  })
                }
              >
                <RotateCcw className="size-4" />
                Restore {excludedCount} excluded {excludedCount === 1 ? 'comp' : 'comps'}
              </Button>
            )}

            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              Estimated {formatDate(val.as_of)} from {val.comps.length} candidate comps within 25 miles.
              <Link to="/properties" className="inline-flex items-center hover:text-primary hover:underline">
                Browse properties
                <ArrowUpRight className="size-3" />
              </Link>
            </p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
