import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Lock, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { AddUnitDialog } from '@/components/add-unit-dialog'
import {
  useUnits,
  useDeleteUnit,
  useCreateUnit,
  useListingSpaces,
  unitSizeLabel,
  type ListingSpace,
  type Unit,
} from '@/hooks/use-units'
import { useDorCodes } from '@/hooks/use-dor-codes'
import { dorNorm, zoningKindLabels } from '@/lib/zoning'
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
  const { data: adSpaces = [] } = useListingSpaces(property.id)
  const createUnit = useCreateUnit()

  // One click copies an advertised suite into a real unit. The scraped row keeps
  // refreshing on its own; the unit is Alex's editable copy from that moment on.
  const mintUnit = (s: ListingSpace) =>
    createUnit.mutate(
      {
        property_id: property.id,
        label: s.label,
        size_sf: s.size_sf,
        asking_rate_psf: s.rate_psf,
        notes:
          [s.space_use, s.build_out, s.available ? `available ${s.available}` : null]
            .filter(Boolean)
            .join(' · ') || null,
      },
      {
        onSuccess: () => toast.success(`Unit "${s.label}" added from the listing`),
        onError: () => toast.error('Could not add the unit'),
      },
    )
  const [addOpen, setAddOpen] = useState(false)
  // A unit is revised constantly - the space shrinks, the rate moves, it lets.
  // Editing has to be reachable from the row itself, not a re-entry.
  const [editing, setEditing] = useState<Unit | null>(null)
  const countyOwned = property.county_synced_at != null
  const acres = (v: number | null) => (v == null ? null : `${v} ac`)

  // The grey line under the zoning code must MEAN something: several jurisdictions'
  // layers are code-only, so their seeded description just repeats the code ("M-1 —
  // M-1"). Fall through to the bucket, then the jurisdiction.
  const zoningSub =
    property.zoning_description &&
    property.zoning_description.trim().toLowerCase() !== (property.zoning_code ?? '').trim().toLowerCase()
      ? property.zoning_description
      : (property.zoning_type ? zoningKindLabels[property.zoning_type] : null) ?? property.zoning_jurisdiction

  // The county's use code with the FDOR meaning underneath (dor_codes is a cheap
  // cached fetch; county 4-digit variants normalize to their standard class).
  const { data: dorEntries } = useDorCodes(property.dor_use_code != null)
  const dorStd = dorNorm(property.dor_use_code)
  const dorDescription = dorStd
    ? (dorEntries ?? []).find((e) => !e.county && e.code === dorStd)?.description ?? null
    : null

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

      {/* Five columns spread out (Alex): ten stats, exactly two rows. */}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-lg border bg-card p-4 sm:grid-cols-5">
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
        {/* Hover answers "what does this district permit" with the county's own wording;
            click lands on the zoning library at THIS code, which carries the reference
            link back to the county source (Alex 2026-08-16). */}
        {property.zoning_code ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                to={`/zoning?j=${encodeURIComponent(property.zoning_jurisdiction ?? '')}&c=${encodeURIComponent(property.zoning_code)}`}
                className="min-w-0 rounded-sm outline-offset-2 hover:bg-accent/50"
              >
                <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                  Zoning
                </div>
                <div className="mt-0.5 truncate text-sm font-semibold underline decoration-dotted underline-offset-2">
                  {property.zoning_code}
                </div>
                {zoningSub && (
                  <div className="truncate text-xs text-muted-foreground">{zoningSub}</div>
                )}
              </Link>
            </TooltipTrigger>
            <TooltipContent className="max-w-72">
              <p className="font-medium">
                {property.zoning_code}
                {property.zoning_description &&
                property.zoning_description.trim().toLowerCase() !==
                  property.zoning_code.trim().toLowerCase()
                  ? ` — ${property.zoning_description}`
                  : ''}
              </p>
              <p className="mt-1 opacity-80">
                {property.zoning_jurisdiction ?? 'Jurisdiction unknown'}
                {property.zoning_type
                  ? ` · ${zoningKindLabels[property.zoning_type] ?? property.zoning_type}`
                  : ''}
              </p>
              <p className="mt-1 opacity-80">
                Click for the full code list and the county's own reference.
              </p>
            </TooltipContent>
          </Tooltip>
        ) : (
          <Stat label="Zoning" value={null} />
        )}
        <Stat
          label="County use (DOR)"
          value={property.dor_use_code}
          sub={dorDescription}
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

      {/* What the live listing itself advertises, suite by suite (U3 scraper).
          Self-refreshing and read-only — one click copies a suite into a real unit. */}
      {adSpaces.length > 0 && (
        <>
          <div className="flex items-center justify-between gap-2 pt-1">
            <h2 className="text-sm font-medium text-muted-foreground">
              Advertised spaces ({adSpaces.length})
            </h2>
            <span className="text-xs text-muted-foreground">from the live listing</span>
          </div>
          <ul className="divide-y rounded-lg border">
            {adSpaces.map((s) => {
              const taken = units.some(
                (u) => (u.label || '').trim().toLowerCase() === s.label.trim().toLowerCase(),
              )
              return (
                <li key={s.id} className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium">{s.label}</span>
                      {s.size_sf != null && (
                        <span className="text-muted-foreground">
                          {s.size_sf.toLocaleString('en-US')} SF
                        </span>
                      )}
                      <span className="text-muted-foreground">
                        {s.rate_psf != null ? `$${s.rate_psf} PSF/yr` : 'rate on request'}
                      </span>
                      {s.available && (
                        <span className="text-muted-foreground">avail {s.available}</span>
                      )}
                    </div>
                    {(s.space_use || s.build_out) && (
                      <div className="truncate text-xs text-muted-foreground">
                        {[s.space_use, s.build_out].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    disabled={taken || createUnit.isPending}
                    title={taken ? 'A unit with this label already exists' : 'Copy into units'}
                    onClick={() => mintUnit(s)}
                  >
                    {taken ? 'In units' : 'Add as unit'}
                  </Button>
                </li>
              )
            })}
          </ul>
        </>
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
