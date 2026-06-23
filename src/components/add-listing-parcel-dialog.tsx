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
  useAddParcelToListing,
  usePropertySearch,
  type ParcelSearchResult,
} from '@/hooks/use-listing-parcels'
import { useCreateProperty, useEnrichProperty } from '@/hooks/use-properties'
import { friendlyDbError } from '@/lib/db-errors'

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
  const { data: results = [], isFetching } = usePropertySearch(address, parcel)
  const addParcel = useAddParcelToListing()
  const createProperty = useCreateProperty()
  const enrich = useEnrichProperty()

  useEffect(() => {
    if (open) {
      setAddress('')
      setParcel('')
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

  const createAndAttach = async () => {
    if (!address.trim()) return
    try {
      const prop = await createProperty.mutateAsync({
        address: address.trim(),
        parcel_number: parcel.trim() || null,
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
              <Label htmlFor="parcel-address">Address</Label>
              <Input
                id="parcel-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="123 Main St"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="parcel-id">Parcel ID</Label>
              <Input
                id="parcel-id"
                value={parcel}
                onChange={(e) => setParcel(e.target.value)}
                placeholder="county folio / strap"
              />
            </div>
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
            Not in the list? Create it as a new property — size and owner data fill in from the
            county appraiser using the parcel ID.
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={createAndAttach} disabled={pending || !address.trim()}>
            {pending ? 'Adding…' : 'Create & add'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
