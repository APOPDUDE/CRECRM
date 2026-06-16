import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { format } from 'date-fns'
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
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { propertyKindLabels } from '@/components/property-form-dialog'
import { useCreateMatch } from '@/hooks/use-matches'
import { useCreateProperty } from '@/hooks/use-properties'
import { useScrapePropertyByUrl } from '@/hooks/use-automation'
import type { TenantRepDetail } from '@/hooks/use-tenant-reps'
import type { Enums } from '@/lib/database.types'
import { friendlyDbError } from '@/lib/db-errors'
import { automationEnabled } from '@/lib/n8n'

const NONE = '__none__'
type Mode = 'paste' | 'manual'

interface AddPropertyMatchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tenantRep: TenantRepDetail
}

const numOrNull = (v: string | undefined) => (v && v.trim() ? Number(v) : null)
const intOrNull = (v: string | undefined) => (v && v.trim() ? Math.round(Number(v)) : null)

export function AddPropertyMatchDialog({
  open,
  onOpenChange,
  tenantRep,
}: AddPropertyMatchDialogProps) {
  const scrape = useScrapePropertyByUrl()
  const createProperty = useCreateProperty()
  const createMatch = useCreateMatch()
  const showPaste = automationEnabled()

  const [mode, setMode] = useState<Mode>('paste')
  const [links, setLinks] = useState('')
  const [m, setM] = useState<Record<string, string>>({ property_type: NONE })

  useEffect(() => {
    if (open) {
      // Default to manual entry — adding a property here never calls n8n. The
      // "paste a link" scrape flow is opt-in via the button below.
      setMode('manual')
      setLinks('')
      setM({ property_type: NONE })
    }
  }, [open])

  const setF = (k: string) => (e: { target: { value: string } }) =>
    setM((prev) => ({ ...prev, [k]: e.target.value }))

  const handleScrape = (e: FormEvent) => {
    e.preventDefault()
    const urls = links
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 5)
    if (!urls.length) return
    scrape.mutate(
      { urls, tenantRepId: tenantRep.id },
      {
        onSuccess: (res) => {
          const n = res?.scraped ?? urls.length
          toast.success(`Added ${n} ${n === 1 ? 'property' : 'properties'}`)
          onOpenChange(false)
        },
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : 'Could not scrape those listings'),
      },
    )
  }

  const pending = createProperty.isPending || createMatch.isPending

  const handleManual = async (e: FormEvent) => {
    e.preventDefault()
    if (!m.address?.trim()) return
    try {
      const prop = await createProperty.mutateAsync({
        address: m.address.trim(),
        city: m.city?.trim() || null,
        state: m.state?.trim() || null,
        zip: m.zip?.trim() || null,
        property_type: m.property_type === NONE ? null : (m.property_type as Enums<'property_kind'>),
        building_sf: intOrNull(m.building_sf),
        land_acres: numOrNull(m.land_acres),
        asking_rate_psf: numOrNull(m.asking_rate_psf),
        asking_price: numOrNull(m.asking_price),
        specs: m.specs?.trim() || null,
        source: 'manual',
      })
      await createMatch.mutateAsync({
        property_id: prop.id,
        client_id: tenantRep.id,
        owner_id: tenantRep.owner_id,
        inquiry_date: format(new Date(), 'yyyy-MM-dd'),
      })
      toast.success('Property added')
      onOpenChange(false)
    } catch (err) {
      toast.error(friendlyDbError(err, 'Could not add property'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === 'manual' ? 'Add property manually' : 'Add property'}</DialogTitle>
        </DialogHeader>

        {mode === 'paste' && showPaste ? (
          <form onSubmit={handleScrape} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="links">Paste LoopNet link(s)</Label>
              <Textarea
                id="links"
                value={links}
                onChange={(e) => setLinks(e.target.value)}
                rows={4}
                autoFocus
                placeholder={'https://www.loopnet.com/Listing/…\nhttps://www.loopnet.com/Listing/…'}
              />
              <p className="text-xs text-muted-foreground">
                One link per line, up to 5. We'll pull the details (size, rate, broker, photos) and
                add them to this tenant's board.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => setMode('manual')}
            >
              Add manually instead
            </Button>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={scrape.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={scrape.isPending || !links.trim()}>
                {scrape.isPending ? 'Scraping…' : 'Add from link(s)'}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <form onSubmit={handleManual} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="man-address">Address *</Label>
              <Input id="man-address" value={m.address ?? ''} onChange={setF('address')} autoFocus />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-2 sm:col-span-1">
                <Label htmlFor="man-city">City</Label>
                <Input id="man-city" value={m.city ?? ''} onChange={setF('city')} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="man-state">State</Label>
                <Input id="man-state" value={m.state ?? ''} onChange={setF('state')} placeholder="FL" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="man-zip">Zip</Label>
                <Input id="man-zip" value={m.zip ?? ''} onChange={setF('zip')} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="man-type">Property type</Label>
              <Select
                value={m.property_type ?? NONE}
                onValueChange={(v) => setM((p) => ({ ...p, property_type: v }))}
              >
                <SelectTrigger id="man-type" className="w-full">
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
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="man-sf">Building SF</Label>
                <Input id="man-sf" type="number" inputMode="numeric" value={m.building_sf ?? ''} onChange={setF('building_sf')} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="man-ac">Land acres</Label>
                <Input id="man-ac" type="number" inputMode="decimal" step="0.01" value={m.land_acres ?? ''} onChange={setF('land_acres')} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="man-rate">Asking rate ($/SF)</Label>
                <Input id="man-rate" type="number" inputMode="decimal" step="0.01" value={m.asking_rate_psf ?? ''} onChange={setF('asking_rate_psf')} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="man-price">Asking price ($)</Label>
                <Input id="man-price" type="number" inputMode="numeric" value={m.asking_price ?? ''} onChange={setF('asking_price')} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="man-specs">Specs / notes</Label>
              <Textarea id="man-specs" rows={2} value={m.specs ?? ''} onChange={setF('specs')} />
            </div>
            <DialogFooter>
              {showPaste && (
                <Button type="button" variant="ghost" onClick={() => setMode('paste')}>
                  Paste a LoopNet link instead
                </Button>
              )}
              <Button type="submit" disabled={pending || !m.address?.trim()}>
                {pending ? 'Adding…' : 'Add property'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
