import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { format } from 'date-fns'
import { Building2, Plus, X } from 'lucide-react'
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
import { useCreateMatch } from '@/hooks/use-matches'
import { useCreateProperty, useEnrichProperty } from '@/hooks/use-properties'
import { usePropertySearch, type ParcelSearchResult } from '@/hooks/use-listing-parcels'
import { useScrapePropertyByUrl } from '@/hooks/use-automation'
import type { TenantRepDetail } from '@/hooks/use-tenant-reps'
import { formatParcelId } from '@/lib/parcel'
import { friendlyDbError } from '@/lib/db-errors'
import { automationEnabled } from '@/lib/n8n'
import { normalizeListingUrl } from '@/lib/listing-url'

type Mode = 'paste' | 'manual'

// Counties with an appraiser adapter (so a parcel-only add can auto-enrich).
const ENRICHABLE_COUNTIES = ['Hillsborough', 'Pinellas', 'Pasco', 'Polk', 'Manatee', 'Sarasota']

interface AddPropertyMatchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tenantRep: TenantRepDetail
  initialMode?: Mode
}

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
  const enrich = useEnrichProperty()
  const showPaste = automationEnabled()

  const [mode, setMode] = useState<Mode>('manual')
  const [loopnetUrls, setLoopnetUrls] = useState<string[]>([''])
  const [crexiUrls, setCrexiUrls] = useState<string[]>([''])
  // Manual mode mirrors the add-parcel-to-listing flow: parcel ID + county (+ optional
  // address), with autofill of existing properties; the appraiser fills the rest.
  const [parcel, setParcel] = useState('')
  const [county, setCounty] = useState('')
  const [address, setAddress] = useState('')
  const { data: results = [], isFetching } = usePropertySearch(address, parcel)

  useEffect(() => {
    if (open) {
      setMode(showPaste ? initialMode : 'manual')
      setLoopnetUrls([''])
      setCrexiUrls([''])
      setParcel('')
      setCounty('')
      setAddress('')
    }
  }, [open, initialMode, showPaste])

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

  const pending = createProperty.isPending || createMatch.isPending
  const matches = results // existing properties matching the typed address/parcel
  const canCreate = !!parcel.trim() && !!county

  const addPursuit = (propertyId: string) =>
    createMatch.mutateAsync({
      property_id: propertyId,
      client_id: tenantRep.id,
      owner_id: tenantRep.owner_id,
      inquiry_date: format(new Date(), 'yyyy-MM-dd'),
    })

  // Attach an existing property to this tenant (creates the pursuit).
  const attachExisting = async (p: ParcelSearchResult) => {
    try {
      await addPursuit(p.id)
      toast.success(`Added ${p.address}`)
      onOpenChange(false)
    } catch (err) {
      toast.error(friendlyDbError(err, 'Could not add property'))
    }
  }

  // Create a new property from parcel + county (appraiser fills address/size/owner), then
  // add it to this tenant's board.
  const handleManual = async (e: FormEvent) => {
    e.preventDefault()
    if (!canCreate) return
    try {
      const formattedParcel = formatParcelId(parcel, county)
      const prop = await createProperty.mutateAsync({
        address: address.trim() || `Parcel ${formattedParcel}`,
        parcel_number: formattedParcel,
        county,
        source: 'manual',
      })
      await addPursuit(prop.id)
      if (prop.parcel_number && prop.county) {
        enrich.mutate(prop.id, {
          onSuccess: () => toast.success('Enriching from county appraiser…'),
        })
      }
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
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="man-parcel">Parcel ID</Label>
                <Input
                  id="man-parcel"
                  value={parcel}
                  onChange={(e) => setParcel(e.target.value)}
                  onBlur={() => setParcel((p) => formatParcelId(p, county))}
                  placeholder="paste raw — we format it"
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="man-county">County</Label>
                <Select
                  value={county}
                  onValueChange={(v) => {
                    setCounty(v)
                    setParcel((p) => formatParcelId(p, v))
                  }}
                >
                  <SelectTrigger id="man-county" className="w-full">
                    <SelectValue placeholder="Select county" />
                  </SelectTrigger>
                  <SelectContent>
                    {ENRICHABLE_COUNTIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="man-address">Address (optional)</Label>
              <Input
                id="man-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="The county appraiser fills this in"
              />
            </div>

            {matches.length > 0 && (
              <div className="overflow-hidden rounded-lg border">
                <div className="border-b bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground">
                  Existing properties — click to add
                </div>
                <ul className="divide-y">
                  {matches.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => attachExisting(p)}
                        className="flex w-full items-center gap-2 p-2.5 text-left text-sm hover:bg-accent/50 disabled:opacity-50"
                      >
                        <Building2 className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{p.address}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {[
                              [p.city, p.state].filter(Boolean).join(', '),
                              p.parcel_number ? `Parcel ${p.parcel_number}` : null,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </span>
                        <Plus className="size-4 shrink-0 text-muted-foreground" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {(address.trim() || parcel.trim()) && matches.length === 0 && !isFetching && (
              <p className="text-xs text-muted-foreground">
                No existing property matches — create a new one.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Not in the list? Enter the parcel ID + county and create it — the county appraiser
              fills in the address, size and owner automatically.
            </p>

            <DialogFooter>
              {showPaste && (
                <Button type="button" variant="ghost" onClick={() => setMode('paste')}>
                  Paste a listing link instead
                </Button>
              )}
              <Button type="submit" disabled={pending || !canCreate}>
                {pending ? 'Adding…' : 'Create & add'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
