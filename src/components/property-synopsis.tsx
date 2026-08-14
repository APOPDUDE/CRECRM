import { useState } from 'react'
import { Lock, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { AddUnitDialog } from '@/components/add-unit-dialog'
import { useUnits, useDeleteUnit, unitSizeLabel, type Unit } from '@/hooks/use-units'
import { formatCurrency, formatSf } from '@/lib/format'
import { formatDate } from '@/lib/dates'
import type { Tables } from '@/lib/database.types'

function Stat({
  label,
  value,
  sub,
  locked,
}: {
  label: string
  value: string | null
  sub?: string | null
  locked?: boolean
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
        {label}
        {locked && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Lock className="size-3 shrink-0 opacity-50" />
            </TooltipTrigger>
            <TooltipContent className="max-w-64">
              From the county appraiser's roll. Not editable here — the roll is the source of
              truth, and a listing site's number or a typo would only overwrite it wrongly.
            </TooltipContent>
          </Tooltip>
        )}
      </dt>
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
 * The facts you need before reading anything else on the page, plus the units
 * actually available to let.
 *
 * The building and land figures are county-owned and shown locked: 28.5% of the
 * matched book disagreed with the roll by more than 10% before the sync, and
 * 9707 Williams Rd was carrying a 60,000 SF import against the county's 93,666.
 * The lock is enforced in Postgres, not just here.
 *
 * Units are the opposite — nothing but Alex knows a landlord will carve 30,000 SF
 * out of a 93,666 SF building, and until he records it that space cannot be found
 * when a client needs exactly that.
 */
export function PropertySynopsis({ property }: { property: Tables<'properties'> }) {
  const { data: units = [] } = useUnits([property.id])
  const del = useDeleteUnit()
  const [addOpen, setAddOpen] = useState(false)
  // A unit is revised constantly - the space shrinks, the rate moves, it lets.
  // Editing has to be reachable from the row itself, not a re-entry.
  const [editing, setEditing] = useState<Unit | null>(null)
  const countyOwned = property.county_synced_at != null
  const acres = (v: number | null) => (v == null ? null : `${v} ac`)

  // "Usable" is the ground you could actually put something on: uplands less the
  // building's own footprint. Total acreage flatters a site that is mostly roof.
  const footprint =
    property.gross_sf != null && property.gross_sf > 0 ? property.gross_sf / 43560 : null
  const wetPct =
    property.land_acres != null && property.usable_acres != null && property.land_acres > 0
      ? Math.round((1 - property.usable_acres / property.land_acres) * 100)
      : null

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">Property highlights</h2>
        {countyOwned && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Lock className="size-3" />
            county appraiser
          </span>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-lg border bg-card p-4 sm:grid-cols-4">
        <Stat label="Gross SF" value={formatSf(property.gross_sf)} locked={countyOwned} />
        <Stat label="Heated SF" value={formatSf(property.heated_sf)} locked={countyOwned} />
        <Stat label="Total acres" value={acres(property.land_acres)} locked={countyOwned} />
        <Stat
          label="Usable acres"
          value={acres(property.net_usable_acres)}
          sub={
            footprint != null
              ? `${wetPct ? `${wetPct}% wet · ` : ''}less ${footprint.toFixed(2)} ac of building`
              : null
          }
        />
        <Stat
          label="Year built"
          value={property.year_built ? String(property.year_built) : null}
          locked={countyOwned}
        />
        <Stat
          label="Building class"
          value={property.building_class ? `Class ${property.building_class}` : null}
        />
        <Stat label="Last sold" value={formatDate(property.last_sale_date)} />
        <Stat label="Sold for" value={formatCurrency(property.last_sale_price)} />
      </dl>

      {/* Available units. A landlord's willingness to split is not on any roll and
          not in any scrape — it only exists if Alex writes it down, and once he
          does the property answers a "30,000 SF warehouse" search. */}
      <div className="flex items-center justify-between gap-2 pt-1">
        <h2 className="text-sm font-medium text-muted-foreground">
          Available units {units.length > 0 && `(${units.length})`}
        </h2>
        <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="size-4" />
          Add unit
        </Button>
      </div>
      {units.length === 0 ? (
        <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          No units recorded. Add one for any space the landlord will carve out — it makes this
          property findable when a client needs exactly that size.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {units.map((u) => (
            <li key={u.id} className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setEditing(u)}
                title="Edit this unit"
                className="min-w-0 flex-1 rounded-l-lg p-3 text-left transition-colors hover:bg-accent"
              >
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{u.label || 'Unit'}</span>
                  <span className="text-muted-foreground">{unitSizeLabel(u)}</span>
                  {u.asking_rate_psf != null && (
                    <span className="text-muted-foreground">${u.asking_rate_psf} PSF</span>
                  )}
                  {u.status && u.status !== 'available' && (
                    <Badge variant="outline" className="border-gray-200 bg-gray-50 text-gray-600">
                      {u.status}
                    </Badge>
                  )}
                </div>
                {u.notes && <div className="truncate text-xs text-muted-foreground">{u.notes}</div>}
              </button>
              <Button
                variant="ghost"
                size="icon"
                className="mr-3 size-8 shrink-0 text-muted-foreground hover:text-destructive"
                title="Remove unit"
                onClick={() =>
                  del.mutate(u.id, {
                    onSuccess: () => toast.success('Unit removed'),
                    onError: () => toast.error('Could not remove the unit'),
                  })
                }
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <AddUnitDialog
        parcels={[{ id: property.id, address: property.address }]}
        defaultPropertyId={property.id}
        open={addOpen}
        onOpenChange={setAddOpen}
      />
      <AddUnitDialog
        parcels={[{ id: property.id, address: property.address }]}
        defaultPropertyId={property.id}
        unit={editing}
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
      />
    </section>
  )
}
