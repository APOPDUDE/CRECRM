import { useEffect, useState } from 'react'
import { Building2, Plus } from 'lucide-react'
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
import {
  useAddParcelToListing,
  usePropertySearch,
  type ParcelSearchResult,
} from '@/hooks/use-listing-parcels'
import { useCreateProperty, useEnrichProperty } from '@/hooks/use-properties'
import { formatParcelId } from '@/lib/parcel'
import { friendlyDbError } from '@/lib/db-errors'

// Counties with a county-appraiser adapter (so a parcel-only add can auto-enrich).
const ENRICHABLE_COUNTIES = ['Hillsborough', 'Pinellas', 'Pasco', 'Polk', 'Manatee', 'Sarasota']

interface AddListingParcelDialogProps {
  listingId: string
  /** property ids already on the listing — hidden from the search results. */
  existingPropertyIds: string[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Add a parcel to a landlord listing's assemblage. Type an address or parcel ID: matching
 * existing properties surface as you type (click one to attach it), or create a brand-new
 * property from the parcel ID (the county appraiser then fills its size/owner data).
 */
export function AddListingParcelDialog({
  listingId,
  existingPropertyIds,
  open,
  onOpenChange,
}: AddListingParcelDialogProps) {
  const [address, setAddress] = useState('')
  const [parcel, setParcel] = useState('')
  const [county, setCounty] = useState('')
  const { data: results = [], isFetching } = usePropertySearch(address, parcel)
  const addParcel = useAddParcelToListing()
  const createProperty = useCreateProperty()
  const enrich = useEnrichProperty()

  useEffect(() => {
    if (open) {
      setAddress('')
      setParcel('')
      setCounty('')
    }
  }, [open])

  const onListing = new Set(existingPropertyIds)
  const matches = results.filter((r) => !onListing.has(r.id))
  const pending = addParcel.isPending || createProperty.isPending

  const attachExisting = (p: ParcelSearchResult) => {
    addParcel.mutate(
      { listingId, propertyId: p.id, isPrimary: false },
      {
        onSuccess: () => {
          toast.success(`Added ${p.address}`)
          onOpenChange(false)
        },
        onError: (e) => toast.error(friendlyDbError(e, 'Could not add that parcel')),
      },
    )
  }

  // Parcel + county is all that's needed — the enricher fills address/size/owner. Address
  // is optional; when blank we stash a parcel placeholder (properties.address is NOT NULL).
  const canCreate = !!parcel.trim() && !!county
  const createAndAttach = async () => {
    if (!canCreate) return
    try {
      const formattedParcel = formatParcelId(parcel, county)
      const prop = await createProperty.mutateAsync({
        address: address.trim() || `Parcel ${formattedParcel}`,
        parcel_number: formattedParcel,
        county,
        source: 'manual',
      })
      await addParcel.mutateAsync({ listingId, propertyId: prop.id, isPrimary: false })
      if (prop.parcel_number && prop.county) {
        enrich.mutate(prop.id, {
          onSuccess: () => toast.success('Enriching from county appraiser…'),
        })
      }
      toast.success(`Added ${prop.address}`)
      onOpenChange(false)
    } catch (e) {
      toast.error(friendlyDbError(e, 'Could not create that property'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a parcel to this listing</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="parcel-id">Parcel ID</Label>
              <Input
                id="parcel-id"
                value={parcel}
                onChange={(e) => setParcel(e.target.value)}
                onBlur={() => setParcel((p) => formatParcelId(p, county))}
                placeholder="paste raw — we format it"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="parcel-county">County</Label>
              <Select
                value={county}
                onValueChange={(v) => {
                  setCounty(v)
                  setParcel((p) => formatParcelId(p, v))
                }}
              >
                <SelectTrigger id="parcel-county" className="w-full">
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
            <Label htmlFor="parcel-address">Address (optional)</Label>
            <Input
              id="parcel-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="The county appraiser fills this in"
            />
          </div>

          {/* Existing matches — click to attach */}
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
              No existing property matches — create a new one below.
            </p>
          )}

          <p className="text-xs text-muted-foreground">
            Not in the list? Enter the parcel ID + county and create it — the county appraiser
            fills in the address, size and owner automatically.
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={createAndAttach} disabled={pending || !canCreate}>
            {pending ? 'Adding…' : 'Create & add'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
