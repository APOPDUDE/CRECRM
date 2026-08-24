import { format } from 'date-fns'
import { Crosshair, MessageSquare, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { CurrencyInput } from '@/components/ui/currency-input'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { OverlayControls } from '@/components/overlay-controls'
import { DorCodePicker } from '@/components/dor-code-picker'
import { PROPERTY_TAG_OPTIONS, type PropertyTagKey } from '@/hooks/use-property-tag-filter'
import { type DorSelection } from '@/lib/zoning'
import type { OverlayState } from '@/lib/overlays'
import type { LatLng } from '@/lib/geo'
import { cn } from '@/lib/utils'

/** Which owner channels count as "verified" while the toggle is on. */
export type OwnerChannels = { phone: boolean; email: boolean }

function Segmented({
  value,
  options,
  onChange,
}: {
  value: string
  options: { v: string; label: string }[]
  onChange: (v: string) => void
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border">
      {options.map((o, i) => (
        <Button
          key={o.v}
          size="sm"
          variant={value === o.v ? 'secondary' : 'ghost'}
          className={`h-7 rounded-none px-2.5 text-xs ${i > 0 ? 'border-l' : ''}`}
          onClick={() => onChange(o.v)}
        >
          {o.label}
        </Button>
      ))}
    </div>
  )
}

function MinMax({
  min,
  max,
  onMin,
  onMax,
  currency,
}: {
  min: string
  max: string
  onMin: (v: string) => void
  onMax: (v: string) => void
  currency?: boolean
}) {
  if (currency) {
    return (
      <div className="flex items-center gap-2">
        <CurrencyInput placeholder="Min" value={min} onValueChange={onMin} className="h-8" />
        <span className="text-muted-foreground">–</span>
        <CurrencyInput placeholder="Max" value={max} onValueChange={onMax} className="h-8" />
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2">
      <Input type="number" inputMode="decimal" placeholder="Min" value={min} onChange={(e) => onMin(e.target.value)} className="h-8" />
      <span className="text-muted-foreground">–</span>
      <Input type="number" inputMode="decimal" placeholder="Max" value={max} onChange={(e) => onMax(e.target.value)} className="h-8" />
    </div>
  )
}

/**
 * The map's left rail (War Room overhaul Phase 2, Mapwise-style): every filter that
 * narrows the pins lives here, beside the map — the top bar keeps only search, the
 * view switch, the count and Export. Order is Alex's: draw shape, sqft, acres, then
 * the toggles. The rail WRITES the same persisted state the table's Filters popover
 * reads — one source of truth, two surfaces.
 */
export function MapFilterRail(props: {
  // draw shape — the completed polygon lives in the parent (it filters table + export)
  polygon: LatLng[] | null
  draft: LatLng[] | null
  onStartDraw: () => void
  onFinishDraw: () => void
  onUndoVertex: () => void
  onCancelDraw: () => void
  onClearShape: () => void
  /** Reset EVERY rail filter (and the shape) to defaults — one tap back to the whole book. */
  onClearAll: () => void
  /** Staged edits waiting to run. The rail's controls edit a pending overlay in the
   *  parent; nothing recomputes until Apply flushes it in one shot (Alex 2026-08-24:
   *  per-change recompute over the 100k-row land book is what made filtering slow). */
  dirty: boolean
  onApply: () => void
  // the only standard filters (Alex): sqft + acres
  sfMin: string
  sfMax: string
  onSfMin: (v: string) => void
  onSfMax: (v: string) => void
  acMin: string
  acMax: string
  onAcMin: (v: string) => void
  onAcMax: (v: string) => void
  /** Land book only: minimum developer suitability score from the enrichment pass. */
  scoreMin: string
  onScoreMin: (v: string) => void
  // On market tri-state + conditional pricing
  status: string
  onStatus: (v: string) => void
  dealType: string
  onDealType: (v: string) => void
  psfMin: string
  psfMax: string
  onPsfMin: (v: string) => void
  onPsfMax: (v: string) => void
  priceMin: string
  priceMax: string
  onPriceMin: (v: string) => void
  onPriceMax: (v: string) => void
  includeUnpriced: boolean
  onIncludeUnpriced: (v: boolean) => void
  // Verified contact: 'all' | 'verified' | 'unverified' — the same tri-state the
  // table's Filters popover writes, so the two surfaces can't disagree.
  ownerFilter: string
  onOwnerFilter: (v: string) => void
  channels: OwnerChannels
  onChannels: (c: OwnerChannels) => void
  activity: string
  onActivity: (v: string) => void
  pushCount: number
  onPush: () => void
  onMessage: () => void
  // Search leases — the windows apply on the map only while this is on
  searchLeases: boolean
  onSearchLeases: (on: boolean) => void
  leaseMin: string
  leaseMax: string
  onLeaseMin: (v: string) => void
  onLeaseMax: (v: string) => void
  leaseMonth: string
  onLeaseMonth: (v: string) => void
  signMin: string
  signMax: string
  onSignMin: (v: string) => void
  onSignMax: (v: string) => void
  leaseSfMin: string
  leaseSfMax: string
  onLeaseSfMin: (v: string) => void
  onLeaseSfMax: (v: string) => void
  dmFilter: string
  onDmFilter: (v: string) => void
  // Tags — multi-select, OR across the picks
  tagFilter: PropertyTagKey[]
  onTagFilter: (next: PropertyTagKey[]) => void
  tagsLoading: boolean
  /** Which book is open — the land book asks different questions of the rail. */
  book?: 'industrial' | 'land'
  // DOR use categories + the zoning axis
  dorSel: DorSelection
  onDorSel: (next: DorSelection) => void
  // Condo units (separately-owned unit parcels) — excluded from canvassing by default
  includeCondos: boolean
  onIncludeCondos: (on: boolean) => void
  /** How many rows the exclusion is currently hiding — 0 while it hides nothing. */
  condoHidden: number
  // Owner operators (the 'owner occupier' tag) — tri-state: in the set / out of it / only them
  ownerOccMode: 'all' | 'hide' | 'only'
  onOwnerOccMode: (m: 'all' | 'hide' | 'only') => void
  // Recently sold — hide owners who closed within the last N years ('' = off)
  soldYears: string
  onSoldYears: (v: string) => void
  includeNoSale: boolean
  onIncludeNoSale: (on: boolean) => void
  // overlays (Phase 1)
  overlays: OverlayState
  onOverlays: (s: OverlayState) => void
  onOverlayIncludeOn: () => void
}) {
  const p = props
  const drawing = p.draft !== null

  // Unchecking the last channel would mean "verified via nothing", which filters
  // everyone out while looking like a narrower search — flip to the other channel
  // instead, so exactly one is always asked for.
  const setChannel = (which: keyof OwnerChannels, on: boolean) => {
    const next = { ...p.channels, [which]: on }
    if (!next.phone && !next.email) {
      next[which === 'phone' ? 'email' : 'phone'] = true
    }
    p.onChannels(next)
  }

  /**
   * The land book hides the questions that only make sense about a BUILDING —
   * building SF, asking rate $/SF/yr, and the whole lease-search block (a lease
   * expiring, a lease signed, leased SF, the tenant's decision maker). Vacant dirt
   * has none of those, and a control that can only ever narrow to nothing is worse
   * than no control (Alex 2026-08-21). Condo units are excluded from the land book
   * by refresh_land_book() itself, so that toggle goes too.
   */
  const isLand = p.book === 'land'

  return (
    <div className="space-y-4 text-sm">
      {/* Draw shape */}
      <div className="space-y-1.5">
        {!drawing ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="sm" variant="outline" onClick={p.onStartDraw}>
              <Crosshair className="size-4" />
              {p.polygon ? 'Redraw shape' : 'Draw shape'}
            </Button>
            {p.polygon && (
              <Button size="sm" variant="ghost" onClick={p.onClearShape}>
                Clear
              </Button>
            )}
            {/* one tap back to a clean slate — shape, sizes, market, DOR, layers, all of it */}
            <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={p.onClearAll}>
              Clear all
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button size="sm" disabled={(p.draft?.length ?? 0) < 3} onClick={p.onFinishDraw}>
                Finish{p.draft && p.draft.length > 0 ? ` (${p.draft.length})` : ''}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={(p.draft?.length ?? 0) === 0}
                onClick={p.onUndoVertex}
              >
                Undo
              </Button>
              <Button size="sm" variant="ghost" onClick={p.onCancelDraw}>
                Cancel
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {(p.draft?.length ?? 0) < 3
                ? 'Click the map to outline your search area (3+ points)'
                : `${p.draft!.length} points — click the first point to close the shape`}
            </p>
          </>
        )}
      </div>

      {!isLand && (
        <div className="space-y-1.5">
          <Label>Sq ft</Label>
          <MinMax currency min={p.sfMin} max={p.sfMax} onMin={p.onSfMin} onMax={p.onSfMax} />
        </div>
      )}
      <div className="space-y-1.5">
        <Label>Acres</Label>
        <MinMax min={p.acMin} max={p.acMax} onMin={p.onAcMin} onMax={p.onAcMax} />
      </div>

      {/* Site score — the enrichment pipeline's 0-100 developer suitability. Land
          book only: it is scored from parcel polygons, and the industrial book is
          mostly buildings the pipeline has nothing to say about. A minimum DROPS
          unscored parcels rather than ranking them last, because "not measured
          enough to publish a number" is not the same as "scores badly". */}
      {isLand && (
        <div className="space-y-1.5">
          <Label>Site score at least</Label>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            placeholder="0-100"
            value={p.scoreMin}
            onChange={(e) => p.onScoreMin(e.target.value)}
            className="h-8"
          />
        </div>
      )}

      {/* Condo units — the Motor Enclave problem: one address, 236 separately-owned
          bays. Out of every search by default; this is the way back in. Absent from
          the land book: refresh_land_book() never admits a condo unit. */}
      <div className={`space-y-1 border-t pt-3${isLand ? ' hidden' : ''}`}>
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <Checkbox
            checked={p.includeCondos}
            onCheckedChange={(v) => p.onIncludeCondos(v === true)}
          />
          Include condo units
        </label>
        {!p.includeCondos && p.condoHidden > 0 && (
          <p className="pl-6 text-xs text-muted-foreground">
            {p.condoHidden.toLocaleString()} hidden in this view
          </p>
        )}
      </div>

      {/* County use codes — what the parcel IS today, per the appraiser */}
      <div className="border-t pt-3">
        <DorCodePicker selection={p.dorSel} onChange={p.onDorSel} book={isLand ? 'land' : 'industrial'} />
      </div>

      {/* The Zoned select left the rail (Alex 2026-08-16, "we only need zoning layers")
          — on the map the zoning question is the layers below, with Include (union) and
          Only (restrict) per layer. The table's Filters popover keeps the select. */}

      {/* Zoning district overlays (Phase 1) */}
      <div className="border-t pt-3">
        <OverlayControls state={p.overlays} onChange={p.onOverlays} onIncludeOn={p.onOverlayIncludeOn} />
      </div>

      {/* Owner operators — buildings whose occupant IS the owner (the 'owner occupier'
          tag, populated from county owner-mails-at-property evidence). A canvass may want
          them in the mix, out of it, or as the whole search. */}
      <div className="space-y-1.5 border-t pt-3">
        <Label>Owner operators</Label>
        <div className="flex gap-1">
          {(
            [
              ['all', 'Include'],
              ['hide', 'Hide'],
              ['only', 'Only'],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => p.onOwnerOccMode(v)}
              className={cn(
                'rounded-md border px-2 py-1 text-xs',
                p.ownerOccMode === v
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Recently sold — an owner who just closed is the worst cold call on the map. Coverage
          is county-partial (Hillsborough ~27%, Polk ~48% carry a recorded sale), so unknown
          sale dates stay visible unless the toggle says otherwise. */}
      <div className="space-y-1.5 border-t pt-3">
        <Label>Last sold</Label>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Hide sold in the last
          <Input
            type="number"
            min={0}
            step={0.5}
            value={p.soldYears}
            onChange={(e) => p.onSoldYears(e.target.value)}
            placeholder="off"
            className="h-7 w-16"
          />
          years
        </div>
        {parseFloat(p.soldYears) > 0 && (
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <Checkbox
              checked={p.includeNoSale}
              onCheckedChange={(v) => p.onIncludeNoSale(v === true)}
            />
            Include properties with no sold date
          </label>
        )}
      </div>

      {/* On market — off = everyone, plus the explicit inverse Alex asked for */}
      <div className="space-y-1.5 border-t pt-3">
        <Label>Market</Label>
        <Segmented
          value={p.status}
          options={[
            { v: 'all', label: 'Any' },
            { v: 'on_market', label: 'On market' },
            { v: 'off_market', label: 'Off market' },
          ]}
          onChange={p.onStatus}
        />
        {p.status === 'on_market' && (
          <div className="space-y-2 pl-2 pt-1">
            <Segmented
              value={p.dealType}
              options={[
                { v: 'all', label: 'Either' },
                { v: 'lease', label: 'For lease' },
                { v: 'sale', label: 'For sale' },
              ]}
              onChange={p.onDealType}
            />
            {/* The price inputs SWITCH with the choice (Alex): lease asks $/SF, sale
                asks total. Never both at once. */}
            {p.dealType === 'lease' && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Rate $/SF/yr</Label>
                <MinMax currency min={p.psfMin} max={p.psfMax} onMin={p.onPsfMin} onMax={p.onPsfMax} />
              </div>
            )}
            {p.dealType === 'sale' && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Asking price</Label>
                <MinMax currency min={p.priceMin} max={p.priceMax} onMin={p.onPriceMin} onMax={p.onPriceMax} />
              </div>
            )}
            {p.dealType !== 'all' && (
              <label className="flex cursor-pointer items-center gap-2 text-xs">
                <Checkbox
                  checked={p.includeUnpriced}
                  onCheckedChange={(v) => p.onIncludeUnpriced(v === true)}
                />
                Include listings without a price
              </label>
            )}
          </div>
        )}
      </div>

      {/* Tags — how the owner has answered, and whether they occupy the building.
          Several can be on at once and they OR together: "interested OR owner operator"
          is one prospecting list, not an impossible intersection. */}
      <div className="space-y-1.5 border-t pt-3">
        <div className="flex items-center justify-between">
          <Label>Tags</Label>
          {p.tagFilter.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs text-muted-foreground"
              onClick={() => p.onTagFilter([])}
            >
              Clear
            </Button>
          )}
        </div>
        <div className="space-y-1">
          {PROPERTY_TAG_OPTIONS.map((o) => (
            <label key={o.key} className="flex cursor-pointer items-center gap-2 text-xs">
              <Checkbox
                checked={p.tagFilter.includes(o.key)}
                onCheckedChange={(v) =>
                  p.onTagFilter(
                    v === true
                      ? [...p.tagFilter, o.key]
                      : p.tagFilter.filter((t) => t !== o.key),
                  )
                }
              />
              {o.label}
            </label>
          ))}
        </div>
        {p.tagFilter.length > 0 && (
          <p className="pl-6 text-xs text-muted-foreground">
            {p.tagsLoading
              ? 'Finding tagged properties…'
              : p.tagFilter.length > 1
                ? 'Any of the checked tags'
                : null}
          </p>
        )}
      </div>

      {/* Verified contact — three-way (Alex 2026-08-19): the checkbox could only ADD
          the verified owners; "get rid of all the verified owners" is the other half of
          the same question and was table-only until now. Same `ownerFilter` state the
          table's popover writes. */}
      <div className="space-y-1.5 border-t pt-3">
        <Label>Verified contact</Label>
        <Segmented
          value={p.ownerFilter}
          options={[
            { v: 'all', label: 'Any' },
            { v: 'verified', label: 'Verified' },
            { v: 'unverified', label: 'Not verified' },
          ]}
          onChange={p.onOwnerFilter}
        />
        {p.ownerFilter === 'verified' && (
          <div className="space-y-2 pl-2">
            <div className="flex items-center gap-4">
              <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                <Checkbox
                  checked={p.channels.phone}
                  onCheckedChange={(v) => setChannel('phone', v === true)}
                />
                Phone
              </label>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                <Checkbox
                  checked={p.channels.email}
                  onCheckedChange={(v) => setChannel('email', v === true)}
                />
                Email
              </label>
            </div>
            <Select value={p.activity} onValueChange={p.onActivity}>
              <SelectTrigger className="h-8 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any activity</SelectItem>
                <SelectItem value="recent">Touched in 30d</SelectItem>
                <SelectItem value="quiet">Quiet 30d+</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" className="h-7 text-xs" onClick={p.onPush} disabled={p.pushCount === 0}>
                <Send className="size-3.5" />
                Push to HighLevel
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={p.onMessage}
                disabled={p.pushCount === 0}
              >
                <MessageSquare className="size-3.5" />
                Message {p.pushCount}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Search leases — new listing lands, draw the area, flip this on: every tenant
          close to expiry nearby, with their decision maker on hover and in the export.
          A building question: hidden in the land book. */}
      <div className={`space-y-1.5 border-t pt-3${isLand ? ' hidden' : ''}`}>
        <label className="flex cursor-pointer items-center gap-2">
          <Checkbox checked={p.searchLeases} onCheckedChange={(v) => p.onSearchLeases(v === true)} />
          <span className="font-medium">Search leases</span>
        </label>
        {p.searchLeases && (
          <div className="space-y-2 pl-6">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Expires (months out)</Label>
              {/^\d{4}-\d{2}$/.test(p.leaseMonth) ? (
                <div className="flex items-center justify-between rounded-md border px-2 py-1">
                  <span className="text-xs">
                    Expiring {format(new Date(`${p.leaseMonth}-01T00:00:00`), 'MMMM yyyy')}
                  </span>
                  <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => p.onLeaseMonth('')}>
                    Clear
                  </Button>
                </div>
              ) : (
                <>
                  <MinMax min={p.leaseMin} max={p.leaseMax} onMin={p.onLeaseMin} onMax={p.onLeaseMax} />
                  <div className="flex flex-wrap gap-1.5">
                    {[3, 6, 12].map((n) => (
                      <Button
                        key={n}
                        variant={p.leaseMin === '' && p.leaseMax === String(n) ? 'secondary' : 'outline'}
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() => {
                          p.onLeaseMin('')
                          p.onLeaseMax(String(n))
                        }}
                      >
                        ≤ {n === 12 ? '1 yr' : `${n} mo`}
                      </Button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Signed (months ago)</Label>
              <MinMax min={p.signMin} max={p.signMax} onMin={p.onSignMin} onMax={p.onSignMax} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Leased SF (the unit, not the shell)</Label>
              <MinMax currency min={p.leaseSfMin} max={p.leaseSfMax} onMin={p.onLeaseSfMin} onMax={p.onLeaseSfMax} />
            </div>
            <Select value={p.dmFilter} onValueChange={p.onDmFilter}>
              <SelectTrigger className="h-8 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any decision maker</SelectItem>
                <SelectItem value="verified">Verified decision maker</SelectItem>
                <SelectItem value="unverified">No verified decision maker</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* Sticky so it's reachable from anywhere in a long rail. Rendered only when
          something is staged — an always-on Apply reads as one more required step. */}
      {p.dirty && (
        <div className="sticky bottom-0 -mx-1 border-t bg-background/95 px-1 pb-1 pt-2 backdrop-blur">
          <Button size="sm" className="w-full" onClick={p.onApply}>
            Apply filters
          </Button>
        </div>
      )}
    </div>
  )
}
