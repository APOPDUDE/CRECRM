import { formatCurrency, formatSf } from '@/lib/format'
import { formatDate } from '@/lib/dates'
import type { Tables } from '@/lib/database.types'

function Stat({
  label,
  value,
  sub,
}: {
  label: string
  value: string | null
  sub?: string | null
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd
        className={`mt-0.5 truncate text-sm font-semibold ${
          value == null ? 'font-normal text-muted-foreground' : ''
        }`}
      >
        {value ?? '—'}
      </dd>
      {value != null && sub && <div className="truncate text-xs text-muted-foreground">{sub}</div>}
    </div>
  )
}

/**
 * The eight facts you need before reading anything else on the page.
 *
 * These all live in the editable grids further down, but on a property with a
 * long conversation history those grids are a scroll away — and "how big, how
 * old, what did they pay" is the context you want in hand while reading the
 * notes, not after them. Deliberately read-only: this is a briefing, and the
 * fields stay editable in one place rather than two.
 */
export function PropertySynopsis({ property }: { property: Tables<'properties'> }) {
  const acres = (v: number | null) => (v == null ? null : `${v} ac`)
  // Uplands are worth calling out as measured vs assumed — a null here means the
  // acreage is total ground, wet included.
  const usableSub =
    property.usable_acres == null
      ? null
      : property.land_acres != null && property.usable_acres < property.land_acres
        ? `${Math.round((1 - property.usable_acres / property.land_acres) * 100)}% wet`
        : 'all dry'

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-muted-foreground">Property at a glance</h2>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-lg border bg-card p-4 sm:grid-cols-4">
        <Stat label="Gross SF" value={formatSf(property.gross_sf)} />
        <Stat label="Heated SF" value={formatSf(property.heated_sf)} />
        <Stat label="Total acres" value={acres(property.land_acres)} />
        <Stat label="Usable acres" value={acres(property.usable_acres)} sub={usableSub} />
        <Stat label="Year built" value={property.year_built ? String(property.year_built) : null} />
        <Stat
          label="Building class"
          value={property.building_class ? `Class ${property.building_class}` : null}
        />
        <Stat label="Last sold" value={formatDate(property.last_sale_date)} />
        <Stat label="Sold for" value={formatCurrency(property.last_sale_price)} />
      </dl>
    </section>
  )
}
