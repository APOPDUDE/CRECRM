import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { format } from 'date-fns'
import { Plus, X } from 'lucide-react'
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
import { useUpsertComp } from '@/hooks/use-comps'
import { useScrapePropertyByUrl } from '@/hooks/use-automation'
import type { TenantRepDetail } from '@/hooks/use-tenant-reps'
import type { Enums } from '@/lib/database.types'
import { friendlyDbError } from '@/lib/db-errors'
import { automationEnabled } from '@/lib/n8n'
import { normalizeListingUrl } from '@/lib/listing-url'

const NONE = '__none__'
type Mode = 'paste' | 'manual'

interface AddPropertyMatchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tenantRep: TenantRepDetail
  initialMode?: Mode
}

const numOrNull = (v: string | undefined) => (v && v.trim() ? Number(v) : null)
const intOrNull = (v: string | undefined) => (v && v.trim() ? Math.round(Number(v)) : null)

/** One URL per box, no spaces, with an "add another" button below. */
function UrlInputList({
  label,
  hint,
  urls,
  setUrls,
  placeholder,
}: {
  label: string
  hint: string
  urls: string[]
  setUrls: (next: string[]) => void
  placeholder: string
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {urls.map((u, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            value={u}
            autoComplete="off"
            placeholder={placeholder}
            onChange={(e) =>
              setUrls(urls.map((x, j) => (j === i ? e.target.value.replace(/\s+/g, '') : x)))
            }
          />
          {urls.length > 1 && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-9 shrink-0 text-muted-foreground"
              onClick={() => setUrls(urls.filter((_, j) => j !== i))}
            >
              <X className="size-4" />
              <span className="sr-only">Remove</span>
            </Button>
          )}
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setUrls([...urls, ''])}
      >
        <Plus className="size-3.5" />
        Add another listing
      </Button>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  )
}

export function AddPropertyMatchDialog({
  open,
  onOpenChange,
  tenantRep,
  initialMode = 'manual',
}: AddPropertyMatchDialogProps) {
  const scrape = useScrapePropertyByUrl()
  const createProperty = useCreateProperty()
  const createMatch = useCreateMatch()
  const upsertComp = useUpsertComp()
  const showPaste = automationEnabled()

  const [mode, setMode] = useState<Mode>('manual')
  const [loopnetUrls, setLoopnetUrls] = useState<string[]>([''])
  const [crexiUrls, setCrexiUrls] = useState<string[]>([''])
  const [m, setM] = useState<Record<string, string>>({ property_type: NONE })

  useEffect(() => {
    if (open) {
      setMode(showPaste ? initialMode : 'manual')
      setLoopnetUrls([''])
      setCrexiUrls([''])
      setM({ property_type: NONE })
    }
  }, [open, initialMode, showPaste])

  const setF = (k: string) => (e: { target: { value: string } }) =>
    setM((prev) => ({ ...prev, [k]: e.target.value }))

  // Paste a mix of LoopNet + Crexi links; we detect the source per URL (so a link
  // in the "wrong" box still works) and run both scrapers at the same time. The
  // scrape runs in the background (~1-2 min) so we close right away rather than
  // making the broker sit and wait.
  const handleScrape = (e: FormEvent) => {
    e.preventDefault()
    const entered = [...loopnetUrls, ...crexiUrls].map((s) => s.trim()).filter(Boolean)
    const normalized = entered.map(normalizeListingUrl)
    const loopnet = [
      ...new Set(normalized.filter((n) => n?.source === 'loopnet').map((n) => n!.url)),
    ]
    const crexi = [...new Set(normalized.filter((n) => n?.source === 'crexi').map((n) => n!.url))]

    if (!loopnet.length && !crexi.length) {
      toast.error(
        entered.length
          ? 'Those don’t look like LoopNet or Crexi listing links'
          : 'Paste at least one listing link',
      )
      return
    }

    const calls: Promise<{ scraped?: number } | undefined>[] = []
    if (loopnet.length)
      calls.push(scrape.mutateAsync({ urls: loopnet, source: 'loopnet', tenantRepId: tenantRep.id }))
    if (crexi.length)
      calls.push(scrape.mutateAsync({ urls: crexi, source: 'crexi', tenantRepId: tenantRep.id }))

    void Promise.allSettled(calls).then((results) => {
      const added = results.reduce(
        (n, r) => n + (r.status === 'fulfilled' ? (r.value?.scraped ?? 0) : 0),
        0,
      )
      if (added > 0) {
        toast.success(`Added ${added} ${added === 1 ? 'property' : 'properties'} to the board`)
      } else {
        const firstError = results.find((r) => r.status === 'rejected') as
          | PromiseRejectedResult
          | undefined
        toast.error(firstError?.reason?.message || 'Could not scrape those listings')
      }
    })

    toast.info('Scraping listings — this takes 1–2 minutes. They’ll appear on the board when ready.')
    onOpenChange(false)
  }

  const pending = createProperty.isPending || createMatch.isPending || upsertComp.isPending

  const handleManual = async (e: FormEvent) => {
    e.preventDefault()
    if (!m.address?.trim()) return
    try {
      const buildingSf = intOrNull(m.building_sf)
      const rate = numOrNull(m.asking_rate_psf)
      const price = numOrNull(m.asking_price)
      const prop = await createProperty.mutateAsync({
        address: m.address.trim(),
        city: m.city?.trim() || null,
        state: m.state?.trim() || null,
        zip: m.zip?.trim() || null,
        property_type: m.property_type === NONE ? null : (m.property_type as Enums<'property_kind'>),
        building_sf: buildingSf,
        land_acres: numOrNull(m.land_acres),
        specs: m.specs?.trim() || null,
        source: 'manual',
      })
      // Asking now lives on the comps time-series (keyed by property_id), not on properties.
      const asOf = format(new Date(), 'yyyy-MM-dd')
      if (rate != null) {
        await upsertComp.mutateAsync({
          property_id: prop.id,
          kind: 'asking',
          deal_type: 'lease',
          asking_lease_rate_psf: rate,
          sf: buildingSf,
          as_of_date: asOf,
          source: 'manual',
        })
      }
      if (price != null) {
        await upsertComp.mutateAsync({
          property_id: prop.id,
          kind: 'asking',
          deal_type: 'sale',
          sale_price: price,
          sf: buildingSf,
          as_of_date: asOf,
          source: 'manual',
        })
      }
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
          <DialogTitle>{mode === 'manual' ? 'Add property manually' : 'Paste listing link'}</DialogTitle>
        </DialogHeader>

        {mode === 'paste' && showPaste ? (
          <form onSubmit={handleScrape} className="space-y-5">
            <UrlInputList
              label="LoopNet listings"
              placeholder="https://www.loopnet.com/Listing/…"
              hint="One link per box. We'll clean it up and pull the details."
              urls={loopnetUrls}
              setUrls={setLoopnetUrls}
            />
            <UrlInputList
              label="Crexi listings"
              placeholder="https://www.crexi.com/properties/…"
              hint="One link per box. Paste from the listing page (not a “recommended” link)."
              urls={crexiUrls}
              setUrls={setCrexiUrls}
            />
            <Button type="button" variant="ghost" className="w-full" onClick={() => setMode('manual')}>
              Add manually instead
            </Button>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit">Add listings</Button>
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
                  Paste a listing link instead
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
