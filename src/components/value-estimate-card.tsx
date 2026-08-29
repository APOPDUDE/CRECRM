import { useState } from 'react'
import { Calculator, Info } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ValuationDetailSheet } from '@/components/valuation-detail-sheet'
import { estimatedAnnualTax, usePropertyValuation } from '@/hooks/use-valuation'
import { compactUsd, formatCurrency } from '@/lib/format'

const confidenceStyles: Record<string, string> = {
  high: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  medium: 'border-amber-200 bg-amber-50 text-amber-700',
  low: 'border-gray-200 bg-gray-50 text-gray-600',
}

/** Confidence is n-of-comps plus how tight they agree — say which, not just "low". */
export function ConfidenceBadge({
  confidence,
  n,
  askingOnly,
}: {
  confidence: string | null | undefined
  n?: number | null
  /** True = every comp behind the number is an asking price — say so on the badge. */
  askingOnly?: boolean | null
}) {
  if (!confidence) return null
  return (
    <Badge variant="outline" className={`font-medium ${confidenceStyles[confidence] ?? confidenceStyles.low}`}>
      {confidence} confidence
      {n != null && ` · ${n} comps`}
      {askingOnly ? ' · asking-only' : ''}
    </Badge>
  )
}

function Metric({
  label,
  value,
  sub,
  hint,
}: {
  label: string
  value: string | null
  sub?: string | null
  hint?: string
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
        {label}
        {hint && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="size-3 cursor-help opacity-60" />
            </TooltipTrigger>
            <TooltipContent className="max-w-64">{hint}</TooltipContent>
          </Tooltip>
        )}
      </dt>
      <dd className={`mt-0.5 truncate text-sm font-semibold ${value == null ? 'font-normal text-muted-foreground' : ''}`}>
        {value ?? '—'}
      </dd>
      {value != null && sub && <div className="truncate text-xs text-muted-foreground">{sub}</div>}
    </div>
  )
}

/**
 * The estimate card on a property page: what we think it's worth, what it
 * should rent for, and what the tax bill would be — with a way into the comps
 * that produced each number. Replaces the old county-averages market card;
 * those averages now live inside the math panel, where they're context rather
 * than the headline.
 */
export function ValueEstimateCard({ propertyId }: { propertyId: string }) {
  const { data: val, isLoading, isError } = usePropertyValuation(propertyId)
  const [mathOpen, setMathOpen] = useState(false)

  if (isLoading) return <Skeleton className="h-64 w-full max-w-2xl" />

  if (isError || !val) {
    return (
      <div className="flex max-w-2xl flex-col justify-center rounded-lg border bg-card p-4">
        <h2 className="text-sm font-semibold">Value estimate</h2>
        <p className="mt-1 text-sm text-muted-foreground">Could not estimate this property.</p>
      </div>
    )
  }

  const isLand = val.land != null && val.sale == null
  const headline = isLand ? val.land : val.sale
  const total = headline?.total ?? null
  const low = headline?.total_low ?? null
  const high = headline?.total_high ?? null
  const unitRate = isLand
    ? val.land?.per_acre != null
      ? `${compactUsd(val.land.per_acre)} / ${val.land.acres_basis === 'usable' ? 'usable ' : ''}acre`
      : null
    : val.sale?.psf != null
      ? `$${val.sale.psf.toFixed(0)} / SF`
      : null
  const tax = estimatedAnnualTax(val.tax)
  // Only the rows the estimate is computed from — the array also carries
  // display-depth comps and county transfer records that never feed the math.
  const compCount = val.comps.filter((c) => c.in_estimate && c.included).length
  const land = val.sale?.land_total ?? 0
  // A land subject's yard rent comes from its own land node; improved sites from lease.
  const landRent = isLand ? (val.land?.rent_monthly ?? 0) : (val.lease?.land_monthly ?? 0)
  const buildingRent = val.lease?.building_monthly ?? 0
  // Per-acre is plain division on figures the engine already returned — a broker
  // comparing IOS sites thinks in $/acre, not $/SF, and the yard is most of the deal.
  // On USABLE acres, not total: 4325 Hwy 92 is 25.94 acres of which 21.49 are
  // wetland, and spreading the price over the swamp read as $27K/acre when the dry
  // ground is worth $133K. For a land subject the engine's rate and basis are used
  // directly — the card must never show a rate the engine didn't use.
  const acres = isLand
    ? (val.land?.basis_acres ?? val.subject.land_acres ?? null)
    : (val.land_component.acres_usable ?? val.subject.land_acres ?? null)
  const acresAreUsable = isLand
    ? val.land?.acres_basis === 'usable'
    : val.land_component.acres_usable != null && !val.land_component.usable_is_estimated
  const pricePerAcre = !isLand && total != null && acres ? total / acres : null
  const rentPerAcreMo = val.lease?.monthly != null && acres ? val.lease.monthly / acres : null
  const landRentPerAcreMo = val.land_component.rent_per_acre_month || null
  const landPerAcre = val.land_component.excess_acre_value || null

  return (
    <div className="flex max-w-2xl flex-col gap-4 rounded-lg border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Value estimate</h2>
          <p className="text-xs text-muted-foreground">
            {val.subject.county ? `${val.subject.county} County comps` : 'Nearby comps'}
            {headline?.avg_miles != null && ` · avg ${headline.avg_miles} mi away`}
          </p>
        </div>
        <ConfidenceBadge
          confidence={headline?.confidence}
          n={headline?.n}
          askingOnly={isLand ? val.land?.asking_only : undefined}
        />
      </div>

      {/* Headline: what it's worth. */}
      <div>
        <div className="text-3xl font-semibold tracking-tight">
          {total != null ? compactUsd(total) : '—'}
          {/* Both units, always. A building trades on $/SF and a yard on $/acre,
              and most of these properties are some of each. */}
          {(unitRate || pricePerAcre) && (
            <span className="ml-2 text-base font-normal text-muted-foreground">
              {[
                unitRate,
                pricePerAcre
                  ? `${compactUsd(pricePerAcre)} / ${acresAreUsable ? 'usable ' : ''}acre`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          )}
        </div>
        {low != null && high != null ? (
          <>
            {/* When the yard is doing the work, say so on the face of the card —
                a 5,000 SF building on 5 acres is mostly dirt, and the headline
                alone hides that. */}
            {!isLand && land > 0 && (
              <p className="mt-0.5 text-xs">
                <span className="text-muted-foreground">Building</span>{' '}
                <span className="font-medium">{compactUsd(val.sale?.building_total)}</span>
                <span className="text-muted-foreground"> + land </span>
                <span className="font-medium">{compactUsd(land)}</span>
                <span className="text-muted-foreground">
                  {' '}
                  ({val.land_component.excess_acres} ac
                  {landPerAcre ? ` at ${compactUsd(landPerAcre)}/ac` : ''})
                </span>
              </p>
            )}
            <p className="mt-0.5 text-xs text-muted-foreground">
              Range {compactUsd(low)} – {compactUsd(high)}
              {val.sale?.cap_rate != null && ` · comps averaging a ${val.sale.cap_rate}% cap`}
            </p>
          </>
        ) : (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {val.subject.sf
              ? 'Not enough sale comps nearby.'
              : val.subject.land_acres
                ? 'Not enough land comps nearby to value this parcel.'
                : 'No building size or acreage on file — add one to value it.'}
          </p>
        )}
        {/* What can be built here decides what dirt is worth; say what we know. */}
        {isLand &&
          (val.subject.zoning_code ||
            (acresAreUsable &&
              val.subject.land_acres != null &&
              acres != null &&
              acres < val.subject.land_acres)) && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {[
                val.subject.zoning_code
                  ? `Zoned ${val.subject.zoning_code}${
                      val.subject.zoning_description ? ` — ${val.subject.zoning_description}` : ''
                    }`
                  : null,
                acresAreUsable &&
                val.subject.land_acres != null &&
                acres != null &&
                acres < val.subject.land_acres
                  ? `priced on ${acres} usable of ${val.subject.land_acres} ac`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}
      </div>

      {/* Rent, split. The building and the yard are two different products let on
          two different units, and on an IOS site the yard is most of the cheque. */}
      {!isLand && landRent > 0 && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border bg-muted/40 p-3">
          <Metric
            label="Building rent"
            value={buildingRent > 0 ? `${formatCurrency(buildingRent)}/mo` : null}
            sub={val.lease?.psf != null ? `$${val.lease.psf.toFixed(2)} PSF/yr` : null}
            hint="The building on its own, at the comp-derived rate. Its own parking and apron are already in this."
          />
          <Metric
            label="Yard rent"
            value={`${formatCurrency(landRent)}/mo`}
            sub={
              landRentPerAcreMo
                ? `${formatCurrency(landRentPerAcreMo)}/acre/mo · ${val.land_component.rentable_acres} ac`
                : null
            }
            hint={`${val.land_component.excess_acres} acres of usable land beyond the building's own site${
              val.land_component.rent_capped
                ? `, of which ${val.land_component.rentable_acres} are priced as yard`
                : ''
            }.`}
          />
        </dl>
      )}

      {isLand ? (
        /* A vacant parcel has no building rent — its one rent number is the yard,
           and it's an "if let as IOS" figure, not income the ground earns today. */
        <dl className="grid grid-cols-3 gap-x-4 gap-y-3 border-t pt-3">
          <Metric
            label="Yard rent"
            value={landRent > 0 ? `${formatCurrency(landRent)}/mo` : null}
            sub={
              landRent > 0 && val.land?.rent_per_acre_month
                ? `${formatCurrency(val.land.rent_per_acre_month)}/acre/mo · ${val.land.rentable_acres} ac`
                : null
            }
            hint={`If cleared and let as an industrial outdoor storage yard, at the ${
              val.land?.rent_source === 'alex'
                ? 'county market rate'
                : 'estimated county rate — confirm it'
            }. Raw or wooded ground needs site work first.`}
          />
          <Metric
            label="Yard rent per year"
            value={landRent > 0 ? formatCurrency(landRent * 12) : null}
            sub={val.land?.rent_capped ? `capped at ${val.land.rentable_acres} rentable ac` : null}
          />
          <Metric
            label="Annual taxes"
            value={tax != null ? formatCurrency(tax) : null}
            sub={val.tax ? `${val.tax.millage} mills` : null}
            hint={
              val.tax
                ? `${val.tax.rate_pct}% of value at ${val.tax.county ?? 'county'} millage${
                    val.tax.source === 'broker' ? '' : ' — an approximate rate you can correct'
                  }.`
                : undefined
            }
          />
        </dl>
      ) : (
      <dl className="grid grid-cols-3 gap-x-4 gap-y-3 border-t pt-3">
        <Metric
          label={landRent > 0 ? 'Total rent' : 'Rent'}
          value={
            landRent > 0
              ? val.lease?.monthly != null
                ? `${formatCurrency(val.lease.monthly)}/mo`
                : null
              : val.lease?.psf != null
                ? `$${val.lease.psf.toFixed(2)} PSF`
                : null
          }
          sub={
            landRent > 0
              ? rentPerAcreMo
                ? `${formatCurrency(rentPerAcreMo)}/${acresAreUsable ? 'usable ' : ''}ac/mo`
                : null
              : 'net, NNN basis'
          }
          hint="Base rent before opex. The building rate is the weighted median of the lease comps; the yard is priced per acre."
        />
        <Metric
          label={landRent > 0 ? 'Rent per year' : 'Monthly rent'}
          value={
            landRent > 0
              ? val.lease?.annual != null
                ? formatCurrency(val.lease.annual)
                : null
              : val.lease?.monthly != null
                ? `${formatCurrency(val.lease.monthly)}/mo`
                : null
          }
          sub={
            landRent > 0
              ? val.subject.sf
                ? `$${((val.lease?.annual ?? 0) / val.subject.sf).toFixed(2)} PSF effective`
                : null
              : val.lease?.monthly_low != null && val.lease?.monthly_high != null
                ? `${compactUsd(val.lease.monthly_low)} – ${compactUsd(val.lease.monthly_high)}`
                : null
          }
          hint={
            landRent > 0
              ? "Building plus yard, then divided back over the building's SF — what the whole deal works out to per foot."
              : undefined
          }
        />
        <Metric
          label="Annual taxes"
          value={tax != null ? formatCurrency(tax) : null}
          sub={val.tax ? `${val.tax.millage} mills` : null}
          hint={
            val.tax
              ? `${val.tax.rate_pct}% of value at ${val.tax.county ?? 'county'} millage${
                  val.tax.source === 'broker' ? '' : ' — an approximate rate you can correct'
                }.`
              : undefined
          }
        />
      </dl>
      )}

      <Button variant="outline" size="sm" className="self-start" onClick={() => setMathOpen(true)}>
        <Calculator className="size-4" />
        Comps &amp; math · {compCount} in the estimate
      </Button>

      <ValuationDetailSheet propertyId={propertyId} open={mathOpen} onOpenChange={setMathOpen} />
    </div>
  )
}
