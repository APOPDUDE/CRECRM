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
}: {
  confidence: string | null | undefined
  n?: number | null
}) {
  if (!confidence) return null
  return (
    <Badge variant="outline" className={`font-medium ${confidenceStyles[confidence] ?? confidenceStyles.low}`}>
      {confidence} confidence
      {n != null && ` · ${n} comps`}
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
      ? `${compactUsd(val.land.per_acre)} / acre`
      : null
    : val.sale?.psf != null
      ? `$${val.sale.psf.toFixed(0)} / SF`
      : null
  const tax = estimatedAnnualTax(val.tax)
  const compCount = val.comps.filter((c) => c.included).length
  const land = val.sale?.land_total ?? 0
  const landRent = val.lease?.land_monthly ?? 0

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
        <ConfidenceBadge confidence={headline?.confidence} n={headline?.n} />
      </div>

      {/* Headline: what it's worth. */}
      <div>
        <div className="text-3xl font-semibold tracking-tight">
          {total != null ? compactUsd(total) : '—'}
          {unitRate && <span className="ml-2 text-base font-normal text-muted-foreground">{unitRate}</span>}
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
                  ({val.land_component.excess_acres} excess ac)
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
            {val.subject.sf ? 'Not enough sale comps nearby.' : 'No building size on file — add one to value it.'}
          </p>
        )}
      </div>

      <dl className="grid grid-cols-3 gap-x-4 gap-y-3 border-t pt-3">
        <Metric
          label="Rent"
          value={val.lease?.psf != null ? `$${val.lease.psf.toFixed(2)} PSF` : null}
          sub={val.lease ? 'net, NNN basis' : null}
          hint="Base rent per SF per year, before opex. Weighted median of the lease comps."
        />
        <Metric
          label="Monthly rent"
          value={val.lease?.monthly != null ? `${formatCurrency(val.lease.monthly)}/mo` : null}
          sub={
            landRent > 0
              ? `incl. ${compactUsd(landRent)} yard`
              : val.lease?.monthly_low != null && val.lease?.monthly_high != null
                ? `${compactUsd(val.lease.monthly_low)} – ${compactUsd(val.lease.monthly_high)}`
                : null
          }
          hint={
            landRent > 0
              ? `Building rent plus ${val.land_component.excess_acres} excess acres of yard at ${formatCurrency(val.land_component.rent_per_acre_month)}/acre/month.`
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

      <Button variant="outline" size="sm" className="self-start" onClick={() => setMathOpen(true)}>
        <Calculator className="size-4" />
        See the math · {compCount} comps
      </Button>

      <ValuationDetailSheet propertyId={propertyId} open={mathOpen} onOpenChange={setMathOpen} />
    </div>
  )
}
