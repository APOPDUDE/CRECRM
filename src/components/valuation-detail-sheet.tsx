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

/**
 * Why this comp's number moved. Each adjustment is named rather than folded into
 * one figure — a broker disagreeing with the estimate needs to see WHICH lever
 * did it, since they're tuned separately.
 */
function adjustmentNotes(comp: ValuationComp, subjectClass: string | null): string[] {
  const out: string[] = []
  const pct = (f: number) => `${f > 1 ? '+' : ''}${Math.round((f - 1) * 100)}%`
  if (comp.size_adj != null && Math.abs(comp.size_adj - 1) > 0.005) {
    out.push(`size ${pct(comp.size_adj)}`)
  }
  if (comp.class_adj != null && Math.abs(comp.class_adj - 1) > 0.005) {
    out.push(`class ${comp.building_class}→${subjectClass ?? '?'} ${pct(comp.class_adj)}`)
  }
  if (comp.discount_pct != null && comp.discount_pct > 0) {
    out.push(`asking −${comp.discount_pct}%`)
  }
  return out
}

function CompRow({
  comp,
  subjectClass,
  onToggle,
  disabled,
}: {
  comp: ValuationComp
  subjectClass: string | null
  onToggle: (include: boolean) => void
  disabled: boolean
}) {
  const notes = adjustmentNotes(comp, subjectClass)
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
            {comp.building_class && (
              <Badge variant="outline" className="border-gray-200 bg-gray-50 text-gray-600">
                Class {comp.building_class}
              </Badge>
            )}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">{facts.join(' · ') || '—'}</div>
        </div>
        <div className="shrink-0 sm:text-right">
          <div className="text-sm font-semibold tabular-nums">
            {notes.length > 0 ? (
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
          {notes.length > 0 && (
            <div className="text-xs text-muted-foreground/80">{notes.join(' · ')}</div>
          )}
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
          {(stats?.avg_asking_discount != null || (stats?.n_class_adjusted ?? 0) > 0) && (
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {[
                stats?.avg_asking_discount != null
                  ? `asking comps cut ${stats.avg_asking_discount}% on average`
                  : null,
                (stats?.n_class_adjusted ?? 0) > 0
                  ? `${stats!.n_class_adjusted} restated for building class`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          )}
        </p>
      )}
      <ul className="divide-y overflow-hidden rounded-lg border">
        {comps.map((c) => (
          <CompRow
            key={c.comp_id}
            comp={c}
            subjectClass={val.subject.building_class}
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

/**
 * The land the building doesn't use. Only shown when there is some — most sites
 * are built to roughly the market's typical coverage and this section stays out
 * of the way.
 */
function LandSection({ val }: { val: PropertyValuation }) {
  const lc = val.land_component
  if (!lc || lc.excess_acres <= 0) return null
  const acres = (v: number | null) => (v == null ? '—' : `${v} ac`)
  const footprintAcres =
    val.subject.sf != null && val.subject.sf > 0
      ? Math.round((val.subject.sf / 43560) * 100) / 100
      : null

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">Land beyond the building</h3>
      <div className="space-y-2 rounded-lg border p-3 text-sm">
        {/* Wetland is not yard. Where we've measured it, say so and show what came
            off; where we haven't, say that too — an unmeasured wet site is being
            valued as if it were all dry. */}
        {!lc.usable_is_estimated && lc.acres_total != null && lc.acres_usable != null && (
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-muted-foreground">Total acreage</span>
            <span className="tabular-nums">{acres(lc.acres_total)}</span>
          </div>
        )}
        {!lc.usable_is_estimated &&
          lc.acres_total != null &&
          lc.acres_usable != null &&
          lc.acres_total - lc.acres_usable > 0.01 && (
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-muted-foreground">
                Wetland
                <span className="ml-1 text-xs">
                  National Wetlands Inventory
                  {lc.usable_source === 'manual' ? ' (overridden by hand)' : ''}
                </span>
              </span>
              <span className="tabular-nums">
                − {acres(Math.round((lc.acres_total - lc.acres_usable) * 100) / 100)}
              </span>
            </div>
          )}
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-muted-foreground">
            Usable acreage
            {lc.usable_is_estimated && (
              <span className="ml-1 text-xs">
                — total acreage; uplands not measured here, so a wet site reads high
              </span>
            )}
          </span>
          <span className="font-medium tabular-nums">{acres(lc.acres_usable)}</span>
        </div>
        {/* Two different "usable" numbers, and confusing them double-counts the
            parking. Net usable is the physical yard (uplands less the footprint);
            excess is what earns money on top of the building's own comp. */}
        {footprintAcres != null && lc.acres_usable != null && (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-muted-foreground">Building footprint</span>
              <span className="tabular-nums">− {acres(footprintAcres)}</span>
            </div>
            <div className="flex items-baseline justify-between gap-3 border-t pt-2">
              <span className="font-medium">
                Usable yard
                <span className="ml-1 text-xs font-normal text-muted-foreground">net_usable_acres</span>
              </span>
              <span className="font-semibold tabular-nums">
                {acres(Math.round((lc.acres_usable - footprintAcres) * 100) / 100)}
              </span>
            </div>
          </>
        )}
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-muted-foreground">
            Parking &amp; apron the building's own rate already covers
            <span className="ml-1 text-xs">to {Math.round(lc.typ_coverage * 100)}% county coverage</span>
          </span>
          <span className="tabular-nums">
            − {acres(
              footprintAcres != null
                ? Math.round((lc.supported_acres - footprintAcres) * 100) / 100
                : lc.supported_acres,
            )}
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-3 border-t pt-2">
          <span className="font-medium">Land that earns on top</span>
          <span className="font-semibold tabular-nums">{acres(lc.excess_acres)}</span>
        </div>

        <div className="flex items-baseline justify-between gap-3 border-t pt-2">
          <span className="text-muted-foreground">
            To buy, at {formatCurrency(lc.excess_acre_value)}/acre
            {lc.size_factor < 0.99 && (
              <span className="ml-1 text-xs">
                ({formatCurrency(lc.base_acre_value)} base × {lc.size_factor} for size)
              </span>
            )}
          </span>
          <span className="font-medium tabular-nums">{formatCurrency(lc.sale_contribution)}</span>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-muted-foreground">
            To rent, at {formatCurrency(lc.rent_per_acre_month)}/acre/month
            {lc.rent_capped && (
              <span className="ml-1 text-xs">on {lc.rentable_acres} lettable acres</span>
            )}
          </span>
          <span className="font-medium tabular-nums">
            {formatCurrency(lc.rent_contribution_monthly)}/mo
          </span>
        </div>

        <p className="text-xs text-muted-foreground">
          A comp's $/SF already includes a typical site, so only the acreage beyond that is added —
          otherwise the dirt gets counted twice. Per-acre value falls steeply with size (measured on
          our own sales), so a big back field is not priced like one extra acre by the dock.
          {lc.rent_capped &&
            ` Only ${lc.rentable_acres} acres are priced as yard: past that the land is a development play, not something one tenant lets.`}
          {lc.rent_source !== 'alex' && ' The yard rent for this county is an estimate — worth confirming.'}
          {!lc.excess_value_measured &&
            ' Too few local sales to fit a land value here, so a share of the county land comps was used.'}
        </p>
      </div>
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
            <div className="space-y-2 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
              <p>
                Every comp below is weighted by how close it is, how near in size, and how recent.
                Asking comps count for a little <em>more</em> than executed ones, because asking is
                current — asking comps here are about a month old, executed ones a year and a half.
              </p>
              <p>
                Each rate is then restated for this building: for size, for building class where both
                are known, and — on an asking price — cut by about{' '}
                {val.method?.asking_discount_pct ?? 5}% for the negotiation still to come. That cut
                scales with how far above its peers the comp is asking, so an overpriced listing gives
                up more than a keenly-priced one. The estimate is the weighted median, so no single
                outlier carries it. Untick anything that doesn't fit and the numbers redo themselves.
              </p>
            </div>

            <BucketSection bucket="sale" val={val} propertyId={propertyId} />
            <BucketSection bucket="lease" val={val} propertyId={propertyId} />
            <BucketSection bucket="land" val={val} propertyId={propertyId} />

            <LandSection val={val} />
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
