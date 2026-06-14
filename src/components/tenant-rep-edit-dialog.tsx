import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
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
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { propertyKindLabels } from '@/components/property-form-dialog'
import { ContactSelect } from '@/components/contact-select'
import { leadSourceLabels } from '@/components/source-badge'
import { useUpdateTenantRep } from '@/hooks/use-tenant-reps'
import type { Enums, Tables } from '@/lib/database.types'
import { friendlyDbError } from '@/lib/db-errors'

const NONE = '__none__'
type TenantRep = Tables<'tenant_reps'>

const str = (v: string) => v.trim() || null
const int = (v: string) => (v.trim() === '' ? null : Math.round(Number(v)))
const num = (v: string) => (v.trim() === '' ? null : Number(v))
const s = (v: number | string | null) => (v == null ? '' : String(v))

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
      business_industry: s(tenantRep.business_industry),
      business_website: s(tenantRep.business_website),
      move_in_date: s(tenantRep.move_in_date),
      move_in_context: s(tenantRep.move_in_context),
      property_type: tenantRep.property_type ?? NONE,
      warehouse_sf_min: s(tenantRep.warehouse_sf_min),
      warehouse_sf_max: s(tenantRep.warehouse_sf_max),
      office_sf_min: s(tenantRep.office_sf_min),
      office_sf_max: s(tenantRep.office_sf_max),
      outdoor_storage_min_ac: s(tenantRep.outdoor_storage_min_ac),
      outdoor_storage_max_ac: s(tenantRep.outdoor_storage_max_ac),
      power_requirements: s(tenantRep.power_requirements),
      loading_type: s(tenantRep.loading_type),
      clear_height: s(tenantRep.clear_height),
      target_area: s(tenantRep.target_area),
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
        business_industry: str(f.business_industry),
        business_website: str(f.business_website),
        move_in_date: f.move_in_date || null,
        move_in_context: str(f.move_in_context),
        property_type: f.property_type === NONE ? null : (f.property_type as Enums<'property_kind'>),
        warehouse_sf_min: int(f.warehouse_sf_min),
        warehouse_sf_max: int(f.warehouse_sf_max),
        office_sf_min: int(f.office_sf_min),
        office_sf_max: int(f.office_sf_max),
        outdoor_storage_min_ac: num(f.outdoor_storage_min_ac),
        outdoor_storage_max_ac: num(f.outdoor_storage_max_ac),
        power_requirements: str(f.power_requirements),
        loading_type: str(f.loading_type),
        clear_height: str(f.clear_height),
        target_area: str(f.target_area),
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

  const MinMax = ({ label, minKey, maxKey, step }: { label: string; minKey: string; maxKey: string; step?: string }) => (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="grid grid-cols-2 gap-2">
        <Input type="number" inputMode="decimal" step={step} placeholder="Min" value={f[minKey] ?? ''} onChange={set(minKey)} />
        <Input type="number" inputMode="decimal" step={step} placeholder="Max" value={f[maxKey] ?? ''} onChange={set(maxKey)} />
      </div>
    </div>
  )

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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="tr-industry">Business industry</Label>
              <Input id="tr-industry" value={f.business_industry ?? ''} onChange={set('business_industry')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tr-website">Business website</Label>
              <Input id="tr-website" value={f.business_website ?? ''} onChange={set('business_website')} placeholder="example.com" />
            </div>
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
                  {Object.entries(propertyKindLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
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

          <MinMax label="Warehouse SF" minKey="warehouse_sf_min" maxKey="warehouse_sf_max" />
          <MinMax label="Office SF" minKey="office_sf_min" maxKey="office_sf_max" />
          <MinMax label="Outdoor storage (acres)" minKey="outdoor_storage_min_ac" maxKey="outdoor_storage_max_ac" step="0.1" />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="tr-power">Power requirements</Label>
              <Input id="tr-power" value={f.power_requirements ?? ''} onChange={set('power_requirements')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tr-loading">Loading type</Label>
              <Input id="tr-loading" value={f.loading_type ?? ''} onChange={set('loading_type')} placeholder="Dock-high, grade…" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tr-clear">Clear height</Label>
              <Input id="tr-clear" value={f.clear_height ?? ''} onChange={set('clear_height')} placeholder="e.g. 32'" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tr-area">Target area</Label>
              <Input id="tr-area" value={f.target_area ?? ''} onChange={set('target_area')} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tr-budget">Budget</Label>
            <Input id="tr-budget" value={f.budget ?? ''} onChange={set('budget')} placeholder="e.g. $13–15 PSF NNN" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tr-musthaves">Other requirements / notes</Label>
            <Textarea id="tr-musthaves" rows={2} value={f.must_haves ?? ''} onChange={set('must_haves')} />
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
