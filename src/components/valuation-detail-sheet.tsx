import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, ExternalLink, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ConfidenceBadge } from '@/components/value-estimate-card'
import { useCountyMarketStats } from '@/hooks/use-market'
import { useProperty } from '@/hooks/use-properties'
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
import { listingUrlFromSourceKey } from '@/lib/listing-url'

/**
 * The four tabs: what similar properties are ASKING (lease / sale, with a jump
 * to the live listing) and what similar deals actually DID (leased / sold, with
 * the county's land-vs-building split of each sale). One record type feeds all
 * four — a comp's bucket says which side of the money it's on, its kind says
 * whether it's an ask, a done deal, or a county-recorded transfer.
 */
type CompTab = 'ask_lease' | 'ask_sale' | 'leased' | 'sold'

function tabOf(c: ValuationComp): CompTab {
  const saleSide = c.bucket === 'sale' || c.bucket === 'land'
  if (c.kind === 'asking') return saleSide ? 'ask_sale' : 'ask_lease'
  return saleSide ? 'sold' : 'leased'
}

const tabTitles: Record<CompTab, string> = {
  ask_lease: 'For lease',
  ask_sale: 'For sale',
  leased: 'Leased',
  sold: 'Sold',
}

/** $14.05 for a rate, $605K for a land price — one formatter, keyed by bucket. */
function rateLabel(bucket: ValuationBucket, v: number | null | undefined): string {
  if (v == null) return '—'
  return bucket === 'land' ? `${compactUsd(v)}/AC` : `$${v.toFixed(2)}`
}

/** "Investment" / "Owner User" straight off the listing; CoStar will fill the rest. */
function saleTypeLabel(saleType: string | null): string | null {
  if (!saleType) return null
  const s = saleType.toLowerCase()
  const inv = s.includes('invest')
  const user = s.includes('user') || s.includes('owner')
  if (inv && user) return 'Inv. or user'
  if (inv) return 'Investment'
  if (user) return 'User sale'
  return saleType
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
  const isTransfer = comp.kind === 'transfer'
  const notes = isTransfer ? [] : adjustmentNotes(comp, subjectClass)
  // Transfers carry no adjusted rate — their raw $/SF or $/acre is the story.
  const shownRate = comp.adj_metric ?? comp.metric
  const listingUrl = listingUrlFromSourceKey(comp.source_key, comp.address, comp.city)
  const facts = [
    comp.bucket === 'land' ? (comp.acres ? `${comp.acres} ac` : null) : formatSf(comp.sf),
    comp.miles != null ? `${comp.miles} mi` : null,
    formatDate(comp.comp_date),
    comp.tenant_name,
    comp.lease_structure,
    comp.term_months ? `${comp.term_months} mo` : null,
    comp.cap_rate_pct != null ? `${comp.cap_rate_pct}% cap` : null,
    comp.kind === 'asking' && comp.days_on_market != null ? `${comp.days_on_market} DOM` : null,
    (comp.bucket === 'sale' || comp.bucket === 'land') && comp.sale_price != null
      ? formatCurrency(comp.sale_price)
      : null,
  ].filter(Boolean)

  return (
    <li className={`flex items-start gap-3 p-3 ${comp.included ? '' : 'bg-muted/40'}`}>
      {/* Only rows the estimate actually uses get a strike checkbox — a county
          record or display-depth row isn't in the math, so there is nothing to
          strike it FROM. */}
      {comp.in_estimate ? (
        <Checkbox
          className="mt-0.5"
          checked={comp.included}
          disabled={disabled}
          onCheckedChange={(v) => onToggle(v === true)}
          aria-label={comp.included ? 'Exclude this comp' : 'Include this comp'}
        />
      ) : (
        <span className="mt-0.5 size-4 shrink-0" aria-hidden />
      )}
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
            {isTransfer ? (
              <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">
                County record
              </Badge>
            ) : comp.kind === 'executed' ? (
              <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                Executed
              </Badge>
            ) : null}
            {comp.kind === 'asking' && comp.listing_active === false && (
              <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                Off market
              </Badge>
            )}
            {saleTypeLabel(comp.sale_type) && (
              <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-700">
                {saleTypeLabel(comp.sale_type)}
              </Badge>
            )}
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
            {/* Straight to the listing. Built from the comp's OWN source_key —
                never the scraped listing_url, which can carry a neighbor's id. */}
            {listingUrl && (
              <a
                href={listingUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                View listing
                <ExternalLink className="size-3" />
              </a>
            )}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">{facts.join(' · ') || '—'}</div>
          {/* The split: what the dirt took vs what the building took, at the
              county's own allocation. Rough by design — it's the county's ratio
              applied to a real price, not an appraisal. */}
          {comp.land_alloc != null && comp.building_alloc != null && (
            <div className="mt-0.5 text-xs text-muted-foreground">
              <span className="font-medium text-foreground/80">Split</span> building{' '}
              {compactUsd(comp.building_alloc)}
              {comp.building_psf_alloc != null && ` ($${comp.building_psf_alloc.toFixed(2)}/SF)`}
              {' + land '}
              {compactUsd(comp.land_alloc)}
              {comp.land_per_acre_alloc != null && ` (${compactUsd(comp.land_per_acre_alloc)}/ac)`}
              {comp.county_land_share != null &&
                ` · county puts ${Math.round(comp.county_land_share * 100)}% in the land`}
            </div>
          )}
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
              rateLabel(comp.bucket, shownRate)
            )}
          </div>
          <div className="text-xs text-muted-foreground tabular-nums">
            {comp.in_estimate
              ? comp.included
                ? `${comp.weight_pct ?? 0}% of estimate`
                : 'excluded'
              : isTransfer
                ? 'evidence only'
                : 'not in estimate'}
          </div>
          {notes.length > 0 && (
            <div className="text-xs text-muted-foreground/80">{notes.join(' · ')}</div>
          )}
        </div>
      </div>
    </li>
  )
}

/**
 * The one line that says how a bucket's headline was built, in the broker's units.
 * The comp-derived rate prices the BUILDING; when the site has excess land, its
 * component is spelled out rather than folded in — this line exists so the broker
 * can check the arithmetic, so the arithmetic has to actually hold.
 */
function bucketMathLine(bucket: ValuationBucket, val: PropertyValuation): string | null {
  const sf = val.subject.sf
  const acres = val.subject.land_acres
  if (bucket === 'lease' && val.lease && sf) {
    const base = `$${val.lease.psf.toFixed(2)} PSF × ${sf.toLocaleString('en-US')} SF ÷ 12 = ${formatCurrency(val.lease.building_monthly)}`
    return val.lease.land_monthly > 0
      ? `${base} + ${formatCurrency(val.lease.land_monthly)} yard = ${formatCurrency(val.lease.monthly)}/mo`
      : `${base}/mo`
  }
  if (bucket === 'sale' && val.sale && sf) {
    const base = `$${val.sale.psf.toFixed(2)} /SF × ${sf.toLocaleString('en-US')} SF = ${formatCurrency(val.sale.building_total)}`
    return val.sale.land_total > 0
      ? `${base} + ${formatCurrency(val.sale.land_total)} land = ${formatCurrency(val.sale.total)}`
      : base
  }
  if (bucket === 'land' && val.land) {
    const landAcres = val.land.basis_acres ?? acres
    if (!landAcres) return null
    const basis = val.land.acres_basis === 'usable' ? 'usable ' : ''
    return `${compactUsd(val.land.per_acre)}/AC × ${landAcres} ${basis}acres = ${formatCurrency(val.land.total)}`
  }
  return null
}

/**
 * One tab pane: the estimate line for the bucket this tab feeds, then the comp
 * rows. Executed rows lead, county records trail — a verified comp outranks a
 * deed stamp.
 */
function CompTabPane({
  tab,
  comps,
  val,
  propertyId,
}: {
  tab: CompTab
  comps: ValuationComp[]
  val: PropertyValuation
  propertyId: string
}) {
  const toggle = useToggleValuationComp()
  const saleSide = tab === 'ask_sale' || tab === 'sold'

  // A land subject values through the land bucket; improved ones through sale/lease.
  // Inferred from ESTIMATE rows only — a county transfer of an improved neighbor is
  // bucket 'sale' regardless of the subject, and counting it flipped land subjects
  // onto the (null) sale stats, silently dropping their math line.
  const bucket: ValuationBucket = saleSide
    ? comps.some((c) => c.in_estimate && c.bucket === 'sale')
      ? 'sale'
      : comps.some((c) => c.in_estimate && c.bucket === 'land')
        ? 'land'
        : val.sale != null
          ? 'sale'
          : 'land'
    : 'lease'
  const stats = bucket === 'sale' ? val.sale : bucket === 'lease' ? val.lease : val.land
  const mathLine = bucketMathLine(bucket, val)

  const ordered = useMemo(() => {
    const rank = (c: ValuationComp) => (c.kind === 'transfer' ? 1 : 0)
    return [...comps].sort((a, b) => rank(a) - rank(b) || (b.weight ?? 0) - (a.weight ?? 0))
  }, [comps])

  const inEstimate = comps.filter((c) => c.in_estimate)
  const included = inEstimate.filter((c) => c.included).length
  const transfers = comps.filter((c) => c.kind === 'transfer').length

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {inEstimate.length > 0
            ? `${included} of ${inEstimate.length} feeding the estimate`
            : 'Evidence only — none of these feed the estimate'}
          {transfers > 0 && ` · ${transfers} county ${transfers === 1 ? 'record' : 'records'}`}
        </p>
        {inEstimate.length > 0 && <ConfidenceBadge confidence={stats?.confidence} />}
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
      {ordered.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          Nothing similar nearby in this bucket.
        </p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border">
          {ordered.map((c) => (
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
      )}
    </div>
  )
}

/**
 * The land the building doesn't use. Only shown when there is some — most sites
 * are built to roughly the market's typical coverage and this section stays out
 * of the way.
 */
function LandSection({ val, propertyId }: { val: PropertyValuation; propertyId: string }) {
  // Already in cache — the property page loaded this row before the sheet opened.
  const { data: property } = useProperty(propertyId)
  const lc = val.land_component
  if (!lc || lc.excess_acres <= 0) return null
  const acres = (v: number | null) => (v == null ? '—' : `${v} ac`)
  const nwi = property?.wet_acres_nwi ?? null
  const county = property?.lowlands_acres_county ?? null
  const countyBinds = county != null && (nwi == null || county > nwi)
  const otherSource = countyBinds ? nwi : county
  const otherLabel = countyBinds ? 'NWI' : 'the county'
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
        {/* Two sources, and they disagree in both directions. Show the one that
            bound and what the other said, rather than resolving it silently — on
            9501 Palm River Rd NWI saw 3.8 acres where the county calls 13.7
            unbuildable, and a broker should get to see that argument. */}
        {!lc.usable_is_estimated &&
          lc.acres_total != null &&
          lc.acres_usable != null &&
          lc.acres_total - lc.acres_usable > 0.01 && (
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-muted-foreground">
                {countyBinds ? 'Lowlands' : 'Wetland'}
                <span className="ml-1 text-xs">
                  {countyBinds ? 'county appraiser' : 'National Wetlands Inventory'}
                  {otherSource != null && ` · ${otherLabel} says ${otherSource} ac`}
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
        {footprintAcres != null && (
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-muted-foreground">
              Building footprint
              <span className="ml-1 text-xs">gross SF</span>
            </span>
            <span className="tabular-nums">− {acres(footprintAcres)}</span>
          </div>
        )}
        <div className="flex items-baseline justify-between gap-3 border-t pt-2">
          <span className="font-medium">
            Usable yard
            <span className="ml-1 text-xs font-normal text-muted-foreground">net_usable_acres</span>
          </span>
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
          The yard is the uplands less the building's own footprint. Per-acre value falls steeply with
          size (measured on our own sales), so a big back field is not priced like one extra acre by
          the dock.
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
 * The comps behind the estimate, organized the way a broker asks for them:
 * what's for lease, what's for sale (each a click from its live listing), what
 * leased, and what sold — with each sale split land vs building. Estimate rows
 * carry a checkbox; strike one and the numbers redo themselves in Postgres.
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

  const excludedCount = val?.comps.filter((c) => c.in_estimate && !c.included).length ?? 0

  const byTab = useMemo(() => {
    const out: Record<CompTab, ValuationComp[]> = { ask_lease: [], ask_sale: [], leased: [], sold: [] }
    for (const c of val?.comps ?? []) out[tabOf(c)].push(c)
    return out
  }, [val])
  const tabs = (Object.keys(tabTitles) as CompTab[]).filter((t) => byTab[t].length > 0)
  const defaultTab = tabs[0] ?? 'ask_lease'

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* The variant has to match the base class's own selector or Tailwind's
          merge leaves both and the narrower data-[side=right]:sm:max-w-sm wins. */}
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 data-[side=right]:sm:max-w-3xl">
        <SheetHeader className="sticky top-0 z-10 border-b bg-popover px-4 py-3">
          <SheetTitle>Comps &amp; the estimate</SheetTitle>
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
              Comps are weighted by distance, size, and recency, then restated for this building —
              size, class, and a ~{val.method?.asking_discount_pct ?? 5}% haircut on asking prices
              that grows with how far above its peers a listing sits. The estimate is the weighted
              median of the checked rows; untick anything that doesn't fit and the numbers redo
              themselves. County records are shown as evidence but never counted.
            </p>

            {tabs.length > 0 ? (
              <Tabs defaultValue={defaultTab}>
                <TabsList className="w-full">
                  {tabs.map((t) => (
                    <TabsTrigger key={t} value={t} className="flex-1">
                      {tabTitles[t]}
                      <span className="ml-1 text-xs text-muted-foreground">{byTab[t].length}</span>
                    </TabsTrigger>
                  ))}
                </TabsList>
                {tabs.map((t) => (
                  <TabsContent key={t} value={t} className="mt-3">
                    <CompTabPane tab={t} comps={byTab[t]} val={val} propertyId={propertyId} />
                  </TabsContent>
                ))}
              </Tabs>
            ) : (
              <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                No comparable properties found within 25 miles.
              </p>
            )}

            <LandSection val={val} propertyId={propertyId} />
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
              Estimated {formatDate(val.as_of)} from comps within 25 miles.
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
