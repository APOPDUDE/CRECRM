import { useEffect, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { propertyKindLabels, tenantPropertyTypeOptions } from '@/components/property-form-dialog'
import { ContactSelect } from '@/components/contact-select'
import { leadSourceLabels } from '@/components/source-badge'
import { useUpdateTenantRep } from '@/hooks/use-tenant-reps'
import type { Enums, Tables } from '@/lib/database.types'
import { friendlyDbError } from '@/lib/db-errors'

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
}: {
  label: string
  minKey: string
  maxKey: string
  step?: string
  values: Record<string, string>
  set: SetHandler
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="grid grid-cols-2 gap-2">
        <Input
          type="number"
          inputMode="decimal"
          step={step}
          placeholder="Min"
          value={values[minKey] ?? ''}
          onChange={set(minKey)}
        />
        <Input
          type="number"
          inputMode="decimal"
          step={step}
          placeholder="Max"
          value={values[maxKey] ?? ''}
          onChange={set(maxKey)}
        />
      </div>
    </div>
  )
}

/**
 * Multi-city input for the target area. Cities are stored comma-separated in the
 * single text column; type a city + Enter to add a chip, click × to remove one.
 * Module scope so the input keeps focus across renders.
 */
function CityTagsInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState('')
  const cities = value
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)

  const add = () => {
    const c = draft.trim()
    if (c && !cities.some((x) => x.toLowerCase() === c.toLowerCase())) {
      onChange([...cities, c].join(', '))
    }
    setDraft('')
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      add()
    } else if (e.key === 'Backspace' && !draft && cities.length) {
      onChange(cities.slice(0, -1).join(', '))
    }
  }

  return (
    <div className="space-y-1.5">
      {cities.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {cities.map((c) => (
            <Badge key={c} variant="secondary" className="gap-1 font-normal">
              {c}
              <button
                type="button"
                onClick={() => onChange(cities.filter((x) => x !== c).join(', '))}
                className="text-muted-foreground hover:text-foreground"
                aria-label={`Remove ${c}`}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={add}
        placeholder="Add a city, press Enter"
      />
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
  const [f, setF] = useState<Record<string, string>>({})
  const [brokerId, setBrokerId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setBrokerId(tenantRep.broker_contact_id ?? null)
    setF({
      deal_type: tenantRep.deal_type ?? 'lease',
      source: tenantRep.source ?? NONE,
      purpose: tenantRep.purpose ?? NONE,
      move_in_date: s(tenantRep.move_in_date),
      move_in_context: s(tenantRep.move_in_context),
      property_type: tenantRep.property_type ?? NONE,
      building_sf_min: s(tenantRep.building_sf_min),
      building_sf_max: s(tenantRep.building_sf_max),
      land_acres_min: s(tenantRep.land_acres_min),
      land_acres_max: s(tenantRep.land_acres_max),
      cap_rate_min: s(tenantRep.cap_rate_min),
      target_markets: s(tenantRep.target_markets),
      budget: s(tenantRep.budget),
      must_haves: s(tenantRep.must_haves),
    })
  }, [open, tenantRep])

  const set = (k: string) => (e: { target: { value: string } }) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }))

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    updateTenantRep.mutate(
      {
        id: tenantRep.id,
        deal_type: (f.deal_type as Enums<'deal_type'>) || 'lease',
        source: f.source === NONE ? null : (f.source as Enums<'lead_source'>),
        broker_contact_id: f.source === 'broker' ? brokerId : null,
        purpose: f.purpose === NONE ? null : (f.purpose as Enums<'client_purpose'>),
        move_in_date: f.move_in_date || null,
        move_in_context: str(f.move_in_context),
        property_type: f.property_type === NONE ? null : (f.property_type as Enums<'property_kind'>),
        building_sf_min: int(f.building_sf_min),
        building_sf_max: int(f.building_sf_max),
        land_acres_min: num(f.land_acres_min),
        land_acres_max: num(f.land_acres_max),
        cap_rate_min: num(f.cap_rate_min),
        target_markets: str(f.target_markets),
        budget: str(f.budget),
        must_haves: str(f.must_haves),
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="tr-movein">Move-in date</Label>
              <Input id="tr-movein" type="date" value={f.move_in_date ?? ''} onChange={set('move_in_date')} />
            </div>
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

          <div className="space-y-2">
            <Label htmlFor="tr-movein-context">Move-in context</Label>
            <Input id="tr-movein-context" value={f.move_in_context ?? ''} onChange={set('move_in_context')} placeholder="e.g. lease expiring, expansion" />
          </div>

          <MinMax label="Building SF" minKey="building_sf_min" maxKey="building_sf_max" values={f} set={set} />
          <MinMax label="Land (acres)" minKey="land_acres_min" maxKey="land_acres_max" step="0.1" values={f} set={set} />

          <div className="space-y-2">
            <Label htmlFor="tr-cap-rate">Min cap rate (%)</Label>
            <Input id="tr-cap-rate" type="number" inputMode="decimal" step="0.01" value={f.cap_rate_min ?? ''} onChange={set('cap_rate_min')} placeholder="e.g. 6.5" />
          </div>

          <div className="space-y-2">
            <Label>Target markets</Label>
            <CityTagsInput
              value={f.target_markets ?? ''}
              onChange={(v) => setF((p) => ({ ...p, target_markets: v }))}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tr-budget">Budget</Label>
            <Input id="tr-budget" value={f.budget ?? ''} onChange={set('budget')} placeholder="e.g. $13–15 PSF NNN" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tr-musthaves">Other requirements / notes</Label>
            <Textarea id="tr-musthaves" rows={2} value={f.must_haves ?? ''} onChange={set('must_haves')} placeholder="Clear height, power, loading, office build-out…" />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={updateTenantRep.isPending}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={updateTenantRep.isPending || (f.source === 'broker' && !brokerId)}
            >
              {updateTenantRep.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
