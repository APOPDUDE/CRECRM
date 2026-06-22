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
import { useCreateProperty, useUpdateProperty, useEnrichProperty } from '@/hooks/use-properties'
import type { Property } from '@/hooks/use-properties'
import type { Enums } from '@/lib/database.types'
import { friendlyDbError } from '@/lib/db-errors'

export const propertyKindLabels: Record<Enums<'property_kind'>, string> = {
  industrial: 'Industrial',
  office: 'Office',
  retail: 'Retail',
  land: 'Land',
  other: 'Other',
}

/** Property types offered for tenant requirements (a focused subset). */
export const tenantPropertyTypeOptions: Enums<'property_kind'>[] = [
  'office',
  'retail',
  'industrial',
  'land',
]

/** Radix Select cannot use an empty string for an item value, so null maps to this sentinel. */
const NO_TYPE = '__none__'

interface PropertyFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When set, the dialog edits this property; otherwise it creates a new one. */
  property?: Property | null
}

export function PropertyFormDialog({ open, onOpenChange, property }: PropertyFormDialogProps) {
  const createProperty = useCreateProperty()
  const updateProperty = useUpdateProperty()
  const enrich = useEnrichProperty()
  const pending = createProperty.isPending || updateProperty.isPending

  const [address, setAddress] = useState('')
  const [parcelNumber, setParcelNumber] = useState('')
  const [county, setCounty] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [zip, setZip] = useState('')
  const [propertyType, setPropertyType] = useState<string>(NO_TYPE)
  const [buildingSf, setBuildingSf] = useState('')
  const [landAcres, setLandAcres] = useState('')
  const [specs, setSpecs] = useState('')
  const [listingStatus, setListingStatus] = useState<Enums<'listing_market_status'>>('on_market')

  useEffect(() => {
    if (open) {
      setAddress(property?.address ?? '')
      setParcelNumber(property?.parcel_number ?? '')
      setCounty(property?.county ?? '')
      setCity(property?.city ?? '')
      setState(property?.state ?? '')
      setZip(property?.zip ?? '')
      setPropertyType(property?.property_type ?? NO_TYPE)
      setBuildingSf(property?.building_sf != null ? String(property.building_sf) : '')
      setLandAcres(property?.land_acres != null ? String(property.land_acres) : '')
      setSpecs(property?.specs ?? '')
      setListingStatus(property?.listing_status ?? 'on_market')
    }
  }, [open, property])

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    const buildingSfTrimmed = buildingSf.trim()
    const landAcresTrimmed = landAcres.trim()
    const values = {
      address: address.trim(),
      city: city.trim() || null,
      state: state.trim() || null,
      zip: zip.trim() || null,
      property_type:
        propertyType === NO_TYPE ? null : (propertyType as Enums<'property_kind'>),
      building_sf: buildingSfTrimmed ? parseInt(buildingSfTrimmed, 10) : null,
      land_acres: landAcresTrimmed ? parseFloat(landAcresTrimmed) : null,
      specs: specs.trim() || null,
      listing_status: listingStatus,
      parcel_number: parcelNumber.trim() || null,
      county: county.trim() || null,
    }
    const onError = (error: unknown) =>
      toast.error(friendlyDbError(error, 'Could not save property'))

    if (property) {
      updateProperty.mutate(
        { id: property.id, ...values },
        {
          onSuccess: () => {
            toast.success('Property updated')
            onOpenChange(false)
          },
          onError,
        },
      )
    } else {
      createProperty.mutate(values, {
        onSuccess: (data) => {
          toast.success('Property created')
          // Auto-enrich from the county appraiser when we have a parcel + county.
          if (data?.id && values.parcel_number && values.county) {
            enrich.mutate(data.id, {
              onSuccess: () => toast.success('Enriching from county appraiser…'),
            })
          }
          onOpenChange(false)
        },
        onError,
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{property ? 'Edit property' : 'Add property'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="property-address">Address</Label>
            <Input
              id="property-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="property-parcel">Parcel ID{!property && ' *'}</Label>
              <Input
                id="property-parcel"
                value={parcelNumber}
                onChange={(e) => setParcelNumber(e.target.value)}
                placeholder="county folio / strap"
                required={!property}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="property-county">County</Label>
              <Input
                id="property-county"
                value={county}
                onChange={(e) => setCounty(e.target.value)}
                placeholder="e.g. Hillsborough"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="property-city">City</Label>
              <Input
                id="property-city"
                value={city}
                onChange={(e) => setCity(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="property-state">State</Label>
              <Input
                id="property-state"
                value={state}
                onChange={(e) => setState(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="property-zip">Zip</Label>
              <Input
                id="property-zip"
                value={zip}
                onChange={(e) => setZip(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="property-type">Type</Label>
              <Select value={propertyType} onValueChange={setPropertyType}>
                <SelectTrigger id="property-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_TYPE}>No type</SelectItem>
                  {Object.entries(propertyKindLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="property-listing-status">Listing status</Label>
              <Select
                value={listingStatus}
                onValueChange={(v) => setListingStatus(v as Enums<'listing_market_status'>)}
              >
                <SelectTrigger id="property-listing-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="on_market">On market</SelectItem>
                  <SelectItem value="off_market">Off market</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="property-building-sf">Building SF</Label>
              <Input
                id="property-building-sf"
                type="number"
                inputMode="numeric"
                value={buildingSf}
                onChange={(e) => setBuildingSf(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="property-land-acres">Land acres</Label>
              <Input
                id="property-land-acres"
                type="number"
                step="0.01"
                value={landAcres}
                onChange={(e) => setLandAcres(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="property-specs">Specs</Label>
            <Textarea
              id="property-specs"
              value={specs}
              onChange={(e) => setSpecs(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={pending || !address.trim() || (!property && !parcelNumber.trim())}
            >
              {pending ? 'Saving…' : property ? 'Save changes' : 'Add property'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
