import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { format } from 'date-fns'
import { Building2, Plus, Search, X } from 'lucide-react'
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
import { resolvePursuitSide, useCreateMatch } from '@/hooks/use-matches'
import { useCreateProperty, useEnrichProperty } from '@/hooks/use-properties'
import { usePropertySearch, type ParcelSearchResult } from '@/hooks/use-listing-parcels'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { useScrapePropertyByUrl } from '@/hooks/use-automation'
import type { TenantRepDetail } from '@/hooks/use-tenant-reps'
import { formatParcelId, ENRICHABLE_COUNTIES } from '@/lib/parcel'
import { friendlyDbError } from '@/lib/db-errors'
import { automationEnabled } from '@/lib/n8n'
import { normalizeListingUrl } from '@/lib/listing-url'

type Mode = 'paste' | 'manual'

interface AddPropertyMatchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tenantRep: TenantRepDetail
  initialMode?: Mode
  /** The side of the flip board this was opened from — breaks ties when the client leases OR buys. */
  boardSide?: 'lease' | 'sale'
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
  boardSide = 'lease',
}: AddPropertyMatchDialogProps) {
  const scrape = useScrapePropertyByUrl()
  const createProperty = useCreateProperty()
  const createMatch = useCreateMatch()
  const enrich = useEnrichProperty()
  const showPaste = automationEnabled()

  const [mode, setMode] = useState<Mode>('manual')
  const [loopnetUrls, setLoopnetUrls] = useState<string[]>([''])
  const [crexiUrls, setCrexiUrls] = useState<string[]>([''])
  // Manual mode leads with a search of the book: with 17,500+ properties the building is
  // almost always already here, so typing its address should find it. Creating from a parcel
  // ID is the fallback for the ones we genuinely don't have.
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [parcel, setParcel] = useState('')
  const [county, setCounty] = useState('')
  const debouncedSearch = useDebouncedValue(search, 200)
  const { data: results = [], isFetching } = usePropertySearch(debouncedSearch)

  useEffect(() => {
    if (open) {
      setMode(showPaste ? initialMode : 'manual')
      setLoopnetUrls([''])
      setCrexiUrls([''])
      setSearch('')
      setCreating(false)
      setParcel('')
      setCounty('')
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

  const addPursuit = async (propertyId: string) =>
    createMatch.mutateAsync({
      property_id: propertyId,
      client_id: tenantRep.id,
      owner_id: tenantRep.owner_id,
      inquiry_date: format(new Date(), 'yyyy-MM-dd'),
      deal_type: await resolvePursuitSide(propertyId, tenantRep.deal_type, boardSide),
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
        // what was typed in the search box is the best address we have until the
        // appraiser answers; it beats a row called "Parcel U-31-28-…"
        address: search.trim() || `Parcel ${formattedParcel}`,
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
              <Button type="submit" disabled={scrape.isPending}>
                {scrape.isPending ? 'Adding…' : 'Add listings'}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          /* min-w-0: DialogContent is a grid, so this form is a grid item and defaults to
             min-width:auto — without it a long parcel id in the results widens the whole
             dialog past its max-width instead of ellipsing. */
          <form onSubmit={handleManual} className="min-w-0 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="man-search">Find the property</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="man-search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Address, city, county or parcel ID"
                  className="pl-8"
                  autoFocus
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Searches every property we have — address, city, county, parcel or folio.
              </p>
            </div>

            {matches.length > 0 && (
              <div className="overflow-hidden rounded-lg border">
                <div className="border-b bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground">
                  Click to add
                </div>
                {/* overflow-x-hidden matters: the vertical scroller sizes to its content, so a
                    long parcel id would otherwise widen the rows instead of ellipsing them. */}
                <ul className="max-h-64 divide-y overflow-y-auto overflow-x-hidden">
                  {matches.map((p) => (
                    <li key={p.id} className="w-full">
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
                              p.county ? `${p.county} County` : null,
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

            {search.trim().length >= 2 && isFetching && matches.length === 0 && (
              <p className="text-xs text-muted-foreground">Searching…</p>
            )}

            {/* Only offer to create once the search has actually come up empty — otherwise the
                fallback competes with the answer that is about to appear. */}
            {search.trim().length >= 2 && !isFetching && matches.length === 0 && !creating && (
              <div className="rounded-lg border border-dashed p-3">
                <p className="text-sm font-medium">Not in the book</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Nothing matches “{search.trim()}”. Add it by parcel ID and the county appraiser
                  fills in the address, size and owner.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => setCreating(true)}
                >
                  <Plus className="size-3.5" />
                  Add by parcel ID
                </Button>
              </div>
            )}

            {creating && (
              <div className="space-y-3 rounded-lg border p-3">
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
                <p className="text-xs text-muted-foreground">
                  We'll file it as “{search.trim()}” until the appraiser returns the real address.
                </p>
              </div>
            )}

            <DialogFooter>
              {showPaste && (
                <Button type="button" variant="ghost" onClick={() => setMode('paste')}>
                  Paste a listing link instead
                </Button>
              )}
              {creating && (
                <Button type="submit" disabled={pending || !canCreate}>
                  {pending ? 'Adding…' : 'Create & add'}
                </Button>
              )}
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
