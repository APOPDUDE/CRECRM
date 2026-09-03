import { useState } from 'react'
import { useResetOn } from '@/hooks/use-reset-on'
import type { FormEvent } from 'react'
import { Archive, ArchiveRestore } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { CurrencyInput } from '@/components/ui/currency-input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { propertyKindLabels, tenantPropertyTypeOptions } from '@/lib/labels'
import { ContactSelect } from '@/components/contact-select'
import { leadSourceLabels } from '@/lib/labels'
import { BuyerCriteriaFields } from '@/components/buyer-criteria-fields'
import { buyerCriteriaToRow, emptyBuyerCriteria, type BuyerCriteria } from '@/lib/buyer-criteria'
import { useUpdateClientStatus, useUpdateTenantRep } from '@/hooks/use-tenant-reps'
import { AreaDrawMap } from '@/components/area-draw-map'
import { isArchivedClient, parseTargetAreas } from '@/lib/clients'
import type { TargetArea } from '@/lib/clients'
import type { Enums, Tables } from '@/lib/database.types'
import { friendlyDbError } from '@/lib/db-errors'
import { cn } from '@/lib/utils'

const NONE = '__none__'
type TenantRep = Tables<'clients'>

const purposeOptions: { value: Enums<'client_purpose'>; label: string }[] = [
  { value: 'expansion', label: 'Expansion' },
  { value: 'first_location', label: 'First location' },
  { value: 'relocation', label: 'Relocation' },
  { value: 'investment', label: 'Investment' },
]

const str = (v: string) => v.trim() || null
const int = (v: string) => (v.trim() === '' ? null : Math.round(Number(v)))
const num = (v: string) => (v.trim() === '' ? null : Number(v))
const s = (v: number | string | null) => (v == null ? '' : String(v))

type SetHandler = (k: string) => (e: { target: { value: string } }) => void

/**
 * A min/max range of number inputs. MUST live at module scope — defining it inside
 * the dialog body makes a new component identity every render, which remounts the
 * inputs on each keystroke and ejects focus (the "one number at a time" bug).
 */
function MinMax({
  label,
  minKey,
  maxKey,
  step,
  values,
  set,
  grouped,
}: {
  label: string
  minKey: string
  maxKey: string
  step?: string
  values: Record<string, string>
  set: SetHandler
  /** Big values (SF, money) read better with thousands separators while typing. */
  grouped?: boolean
}) {
  const field = (key: string, placeholder: string) =>
    grouped ? (
      <CurrencyInput
        placeholder={placeholder}
        value={values[key] ?? ''}
        onValueChange={(v) => set(key)({ target: { value: v } })}
      />
    ) : (
      <Input
        type="number"
        inputMode="decimal"
        step={step}
        placeholder={placeholder}
        value={values[key] ?? ''}
        onChange={set(key)}
      />
    )
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="grid grid-cols-2 gap-2">
        {field(minKey, 'Min')}
        {field(maxKey, 'Max')}
      </div>
    </div>
  )
}

interface TenantRepEditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tenantRep: TenantRep
}

export function TenantRepEditDialog({ open, onOpenChange, tenantRep }: TenantRepEditDialogProps) {
  const updateTenantRep = useUpdateTenantRep()
  const updateStatus = useUpdateClientStatus()
  const archived = isArchivedClient(tenantRep)

  /**
   * Off the roster and back. Undo restores the exact status they held, which Restore on its own
   * can't do — nothing records what someone was before they were archived, so a restore that
   * wasn't a mistake lands them back at Prospect to be re-triaged.
   */
  const toggleArchived = () => {
    const previous = tenantRep.status
    const next = archived ? 'prospect' : ('archived' as const)
    updateStatus.mutate(
      { id: tenantRep.id, status: next },
      {
        onSuccess: () => {
          onOpenChange(false)
          toast.success(archived ? 'Restored to Prospect' : 'Archived', {
            action: {
              label: 'Undo',
              onClick: () => updateStatus.mutate({ id: tenantRep.id, status: previous }),
            },
          })
        },
        onError: (error) =>
          toast.error(friendlyDbError(error, archived ? 'Could not restore' : 'Could not archive')),
      },
    )
  }
  const [f, setF] = useState<Record<string, string>>({})
  const [brokerId, setBrokerId] = useState<string | null>(null)
  const [criteria, setCriteria] = useState<BuyerCriteria>(emptyBuyerCriteria)
  const [areas, setAreas] = useState<TargetArea[]>([])

  useResetOn([open, tenantRep], () => {
    if (!open) return
    setBrokerId(tenantRep.broker_contact_id ?? null)
    setAreas(parseTargetAreas(tenantRep.target_areas))
    setCriteria({
      buyer_kind: tenantRep.buyer_kind,
      product_subclasses: tenantRep.product_subclasses ?? [],
      strategies: tenantRep.strategies ?? [],
      price_min: s(tenantRep.price_min),
      price_max: s(tenantRep.price_max),
      exchange_1031: tenantRep.exchange_1031,
      exchange_deadline: s(tenantRep.exchange_deadline),
      target_areas: parseTargetAreas(tenantRep.target_areas),
    })
    setF({
      deal_type: tenantRep.deal_type ?? 'lease',
      source: tenantRep.source ?? NONE,
      purpose: tenantRep.purpose ?? NONE,
      move_in_date: s(tenantRep.move_in_date),
      property_type: tenantRep.property_type ?? NONE,
      building_sf_min: s(tenantRep.building_sf_min),
      building_sf_max: s(tenantRep.building_sf_max),
      land_acres_min: s(tenantRep.land_acres_min),
      land_acres_max: s(tenantRep.land_acres_max),
      cap_rate_min: s(tenantRep.cap_rate_min),
      rent_budget_min: s(tenantRep.rent_budget_min),
      rent_budget_max: s(tenantRep.rent_budget_max),
      must_haves: s(tenantRep.must_haves),
    })
  })

  const set = (k: string) => (e: { target: { value: string } }) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }))

  // Buyer criteria only apply to the buy side; a pure lease client keeps whatever was
  // stored rather than having it wiped by a form that never showed the fields.
  const isBuySide = (f.deal_type ?? 'lease') !== 'lease'

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    updateTenantRep.mutate(
      {
        id: tenantRep.id,
        ...(isBuySide ? buyerCriteriaToRow(criteria) : {}),
        deal_type: (f.deal_type as Enums<'deal_type'>) || 'lease',
        source: f.source === NONE ? null : (f.source as Enums<'lead_source'>),
        broker_contact_id: f.source === 'broker' ? brokerId : null,
        property_type: f.property_type === NONE ? null : (f.property_type as Enums<'property_kind'>),
        building_sf_min: int(f.building_sf_min),
        building_sf_max: int(f.building_sf_max),
        land_acres_min: num(f.land_acres_min),
        land_acres_max: num(f.land_acres_max),
        cap_rate_min: num(f.cap_rate_min),
        must_haves: str(f.must_haves),
        // Tenant-only fields. The buy side never shows them, so it must not write them
        // either — otherwise a save would resurrect the prose the migration folded away.
        // Geography is one thing for every client, drawn, never prose.
        target_areas: areas as unknown as never,
        ...(isBuySide
          ? {}
          : {
              purpose: f.purpose === NONE ? null : (f.purpose as Enums<'client_purpose'>),
              move_in_date: f.move_in_date || null,
              rent_budget_min: num(f.rent_budget_min),
              rent_budget_max: num(f.rent_budget_max),
            }),
      },
      {
        onSuccess: () => {
          toast.success('Saved')
          onOpenChange(false)
        },
        onError: (error) => toast.error(friendlyDbError(error, 'Could not save requirements')),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit details</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tr-deal-type">Looking to</Label>
            <Select
              value={f.deal_type ?? 'lease'}
              onValueChange={(v) => setF((p) => ({ ...p, deal_type: v }))}
            >
              <SelectTrigger id="tr-deal-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="lease">Lease space</SelectItem>
                <SelectItem value="sale">Buy space</SelectItem>
                <SelectItem value="both">Lease or buy</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tr-source">Source</Label>
            <Select value={f.source ?? NONE} onValueChange={(v) => setF((p) => ({ ...p, source: v }))}>
              <SelectTrigger id="tr-source" className="w-full">
                <SelectValue placeholder="No source" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No source</SelectItem>
                {Object.entries(leadSourceLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {f.source === 'broker' && (
            <div className="space-y-2">
              <Label>Referring broker</Label>
              <ContactSelect value={brokerId} onChange={setBrokerId} placeholder="Select or create broker" />
            </div>
          )}
          {!isBuySide && (
          <div className="space-y-2">
            <Label htmlFor="tr-purpose">Purpose</Label>
            <Select value={f.purpose ?? NONE} onValueChange={(v) => setF((p) => ({ ...p, purpose: v }))}>
              <SelectTrigger id="tr-purpose" className="w-full">
                <SelectValue placeholder="No purpose" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No purpose</SelectItem>
                {purposeOptions.map(({ value, label }) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {!isBuySide && (
            <div className="space-y-2">
              <Label htmlFor="tr-movein">Move-in date</Label>
              <Input id="tr-movein" type="date" value={f.move_in_date ?? ''} onChange={set('move_in_date')} />
            </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="tr-type">Property type</Label>
              <Select value={f.property_type ?? NONE} onValueChange={(v) => setF((p) => ({ ...p, property_type: v }))}>
                <SelectTrigger id="tr-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No type</SelectItem>
                  {tenantPropertyTypeOptions.map((value) => (
                    <SelectItem key={value} value={value}>
                      {propertyKindLabels[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {isBuySide && (
            <div className="space-y-4 rounded-lg border p-3">
              <p className="text-sm font-medium">Buy-side criteria</p>
              <BuyerCriteriaFields value={criteria} onChange={setCriteria} idPrefix="tr-buyer" showAreas={false} />
            </div>
          )}

          <MinMax label="Building SF" minKey="building_sf_min" maxKey="building_sf_max" values={f} set={set} grouped />
          <MinMax label="Land (acres)" minKey="land_acres_min" maxKey="land_acres_max" step="0.1" values={f} set={set} />

          <div className="space-y-2">
            <Label htmlFor="tr-cap-rate">Min cap rate (%)</Label>
            <Input id="tr-cap-rate" type="number" inputMode="decimal" step="0.01" value={f.cap_rate_min ?? ''} onChange={set('cap_rate_min')} placeholder="e.g. 6.5" />
          </div>

          {!isBuySide && (
            <MinMax
              label="Monthly rent budget ($)"
              minKey="rent_budget_min"
              maxKey="rent_budget_max"
              values={f}
              set={set}
              grouped
            />
          )}

          <div className="space-y-2">
            <Label>Where they're looking</Label>
            <p className="text-xs text-muted-foreground">
              Draw the areas. An address is either inside one or it isn't — no city spelling to get
              wrong when something comes up.
            </p>
            <AreaDrawMap areas={areas} onChange={setAreas} />
          </div>



          <div className="space-y-2">
            <Label htmlFor="tr-musthaves">Other requirements / notes</Label>
            <Textarea id="tr-musthaves" rows={2} value={f.must_haves ?? ''} onChange={set('must_haves')} placeholder="Clear height, power, loading, office build-out…" />
          </div>

          {/* Archive sits apart from Cancel/Save: it is the other thing you come here to do
              when a search is over, not a variant of saving. Reversible in one tap either way —
              the toast undoes it, and an archived client shows Restore in its place. */}
          <DialogFooter className="sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              className={cn(!archived && 'text-muted-foreground hover:text-foreground')}
              onClick={toggleArchived}
              disabled={updateStatus.isPending || updateTenantRep.isPending}
            >
              {archived ? (
                <>
                  <ArchiveRestore className="size-4" />
                  Restore
                </>
              ) : (
                <>
                  <Archive className="size-4" />
                  Archive
                </>
              )}
            </Button>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={updateTenantRep.isPending}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={updateTenantRep.isPending || (f.source === 'broker' && !brokerId)}
              >
                {updateTenantRep.isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
