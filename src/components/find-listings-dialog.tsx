import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
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
import { cn } from '@/lib/utils'
import { useSearchListingsForTenant } from '@/hooks/use-automation'
import type { TenantRepDetail } from '@/hooks/use-tenant-reps'

const TYPE_OPTS = [
  { value: 'industrial', label: 'Industrial' },
  { value: 'flex', label: 'Flex' },
  { value: 'office', label: 'Office' },
  { value: 'retail', label: 'Retail' },
  { value: 'land', label: 'Land' },
  { value: 'specialty', label: 'Specialty' },
  { value: 'multifamily', label: 'Multifamily' },
  { value: 'mixed-use', label: 'Mixed-use' },
  { value: 'hotel', label: 'Hotel' },
]

const s = (v: number | null | undefined) => (v == null ? '' : String(v))
const n = (v: string) => (v.trim() ? Number(v) : undefined)

/** Confirm/adjust a tenant's search criteria, then kick off the LoopNet+Crexi search. */
export function FindListingsDialog({
  open,
  onOpenChange,
  tenantRep,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  tenantRep: TenantRepDetail
}) {
  const search = useSearchListingsForTenant()
  const qc = useQueryClient()

  const [markets, setMarkets] = useState('')
  const [types, setTypes] = useState<string[]>([])
  const [f, setF] = useState<Record<string, string>>({})
  const [keywords, setKeywords] = useState('')

  useEffect(() => {
    if (!open) return
    setMarkets(tenantRep.target_markets ?? '')
    setTypes(tenantRep.property_type ? [tenantRep.property_type] : [])
    setF({
      sf_min: s(tenantRep.building_sf_min),
      sf_max: s(tenantRep.building_sf_max),
      ac_min: s(tenantRep.land_acres_min),
      ac_max: s(tenantRep.land_acres_max),
      cap_min: s(tenantRep.cap_rate_min),
      cap_max: '',
      price_min: '',
      price_max: '',
    })
    setKeywords('')
  }, [open, tenantRep])

  const setk = (k: string) => (e: { target: { value: string } }) =>
    setF((p) => ({ ...p, [k]: e.target.value }))
  const toggleType = (v: string) =>
    setTypes((prev) => (prev.includes(v) ? prev.filter((t) => t !== v) : [...prev, v]))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const cities = markets.split(/[,\n/]+/).map((x) => x.trim()).filter(Boolean)
    const criteria: Record<string, unknown> = {
      cities,
      property_types: types,
      building_sf_min: n(f.sf_min),
      building_sf_max: n(f.sf_max),
      land_acres_min: n(f.ac_min),
      land_acres_max: n(f.ac_max),
      cap_rate_min: n(f.cap_min),
      cap_rate_max: n(f.cap_max),
      price_min: n(f.price_min),
      price_max: n(f.price_max),
      keywords: keywords.trim() || undefined,
    }
    search.mutate(
      { tenantRepId: tenantRep.id, criteria },
      {
        onSuccess: () => {
          toast.success('Searching LoopNet + Crexi — new matches appear on the board in ~1–2 min')
          // results land async; refresh the board a few times as they import
          ;[45_000, 90_000, 150_000].forEach((d) =>
            setTimeout(() => qc.invalidateQueries({ queryKey: ['matches'] }), d),
          )
          onOpenChange(false)
        },
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : 'The market search failed'),
      },
    )
  }

  const Num = ({ k, label, step }: { k: string; label: string; step?: string }) => (
    <div className="space-y-1.5">
      <Label htmlFor={`fl-${k}`} className="text-xs">
        {label}
      </Label>
      <Input id={`fl-${k}`} type="number" step={step} value={f[k] ?? ''} onChange={setk(k)} />
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Find listings — confirm criteria</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="fl-markets">Markets (cities, comma-separated)</Label>
            <Input
              id="fl-markets"
              value={markets}
              onChange={(e) => setMarkets(e.target.value)}
              placeholder="Tampa, Plant City, Lakeland"
            />
          </div>
          <div className="space-y-2">
            <Label>Property types</Label>
            <div className="flex flex-wrap gap-1.5">
              {TYPE_OPTS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => toggleType(o.value)}
                  className={cn(
                    'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                    types.includes(o.value)
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-accent',
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="fl-kw">Keywords</Label>
            <Input
              id="fl-kw"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="cold storage, dock high, rail"
            />
            <p className="text-xs text-muted-foreground">
              Filters results whose description / subtype matches — e.g. "cold storage" surfaces
              specialty listings a plain industrial search misses.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Num k="sf_min" label="Min SF" />
            <Num k="sf_max" label="Max SF" />
            <Num k="ac_min" label="Min acres" step="0.1" />
            <Num k="ac_max" label="Max acres" step="0.1" />
            <Num k="cap_min" label="Min cap %" step="0.1" />
            <Num k="cap_max" label="Max cap %" step="0.1" />
            <Num k="price_min" label="Min price $" />
            <Num k="price_max" label="Max price $" />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={search.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={search.isPending}>
              {search.isPending ? 'Starting…' : 'Search LoopNet + Crexi'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
