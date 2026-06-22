import { Badge } from '@/components/ui/badge'
import { usePropertyComps } from '@/hooks/use-comps'
import { clientLabel } from '@/hooks/use-suggestions'
import { formatCurrency, formatPsf, formatSf } from '@/lib/format'
import { formatDate } from '@/lib/dates'

function Cell({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  )
}

/**
 * Executed comps for a property — the ACTUAL closed-deal lease/sale terms + booked
 * commission, distinct from the asking figures shown in "Pricing & size". Hidden when
 * the property has no closed deals.
 */
export function PropertyComps({ propertyId }: { propertyId: string }) {
  const { data: comps = [] } = usePropertyComps(propertyId)
  if (comps.length === 0) return null

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-muted-foreground">Closed deals (executed comps)</h2>
      <div className="space-y-2">
        {comps.map((c) => {
          const isSale = c.deal_type === 'sale'
          const who = clientLabel(c.pursuit?.client ?? null)
          return (
            <div key={c.id} className="rounded-lg border bg-card p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="border-emerald-200 bg-emerald-50 font-medium text-emerald-700">
                  Executed {isSale ? 'sale' : 'lease'}
                </Badge>
                <span className="text-sm font-medium">{who}</span>
                {c.executed_at && (
                  <span className="text-xs text-muted-foreground">· {formatDate(c.executed_at)}</span>
                )}
              </div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
                {isSale ? (
                  <>
                    <Cell label="Sale price" value={formatCurrency(c.sale_price)} />
                    <Cell label="Cap rate" value={c.cap_rate_pct != null ? `${c.cap_rate_pct}%` : null} />
                    <Cell
                      label="Price / SF"
                      value={c.sale_price && c.sf ? formatPsf(c.sale_price / c.sf) : null}
                    />
                  </>
                ) : (
                  <>
                    <Cell label="Executed rate" value={formatPsf(c.executed_lease_rate_psf)} />
                    <Cell label="Structure" value={c.lease_structure} />
                    <Cell label="Term" value={c.term_months != null ? `${c.term_months} mo` : null} />
                    <Cell
                      label="Free rent"
                      value={c.free_rent_months != null ? `${c.free_rent_months} mo` : null}
                    />
                    <Cell label="TI / SF" value={formatPsf(c.ti_psf)} />
                    <Cell label="Escalations" value={c.escalations} />
                    <Cell label="Commencement" value={formatDate(c.commencement_date)} />
                    <Cell label="Expiration" value={formatDate(c.expiration_date)} />
                  </>
                )}
                <Cell label="Commission booked" value={formatCurrency(c.pursuit?.actual_fee)} />
                <Cell label="SF" value={formatSf(c.sf)} />
              </dl>
            </div>
          )
        })}
      </div>
    </section>
  )
}
