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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CompanySelect } from '@/components/company-select'
import { propertyKindLabels } from '@/components/property-form-dialog'
import { leadSourceLabels } from '@/components/source-badge'
import { useAuth } from '@/hooks/use-auth'
import { supabase } from '@/lib/supabase'
import type { Enums } from '@/lib/database.types'
import { friendlyDbError } from '@/lib/db-errors'

const NONE = '__none__'

interface AddListingDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Pre-selects the For Lease / For Sale tab the user is on. */
  defaultDealType?: Enums<'deal_type'>
}

export function AddListingDialog({
  open,
  onOpenChange,
  defaultDealType = 'lease',
}: AddListingDialogProps) {
  const { session } = useAuth()
  const queryClient = useQueryClient()
  const [pending, setPending] = useState(false)

  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [propertyType, setPropertyType] = useState<string>(NONE)
  const [landlordId, setLandlordId] = useState<string | null>(null)
  const [dealType, setDealType] = useState<Enums<'deal_type'>>(defaultDealType)
  const [rate, setRate] = useState('')
  const [price, setPrice] = useState('')
  const [source, setSource] = useState<string>(NONE)

  useEffect(() => {
    if (open) {
      setAddress('')
      setCity('')
      setState('')
      setPropertyType(NONE)
      setLandlordId(null)
      setDealType(defaultDealType)
      setRate('')
      setPrice('')
      setSource(NONE)
    }
  }, [open, defaultDealType])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!session?.user.id) {
      toast.error('You must be signed in to add a listing')
      return
    }
    setPending(true)
    try {
      // single transactional RPC so a failed listing insert can't orphan the property
      const { error } = await supabase.rpc('create_property_and_listing', {
        p_owner: session.user.id,
        p_address: address.trim(),
        p_deal_type: dealType,
        p_city: city.trim() || undefined,
        p_state: state.trim() || undefined,
        p_property_type: propertyType === NONE ? undefined : (propertyType as Enums<'property_kind'>),
        p_landlord_company_id: landlordId ?? undefined,
        p_source: source === NONE ? undefined : (source as Enums<'lead_source'>),
        p_asking_rate_psf: (dealType === 'lease' || dealType === 'both') && rate ? Number(rate) : undefined,
        p_asking_price: (dealType === 'sale' || dealType === 'both') && price ? Number(price) : undefined,
      })
      if (error) throw error

      queryClient.invalidateQueries({ queryKey: ['listings'] })
      queryClient.invalidateQueries({ queryKey: ['properties'] })
      toast.success('Listing added')
      onOpenChange(false)
    } catch (error) {
      toast.error(friendlyDbError(error, 'Could not add listing'))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add property</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="listing-address">Address</Label>
            <Input
              id="listing-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-2">
              <Label htmlFor="listing-city">City</Label>
              <Input id="listing-city" value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="listing-state">State</Label>
              <Input id="listing-state" value={state} onChange={(e) => setState(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="listing-property-type">Property type</Label>
            <Select value={propertyType} onValueChange={setPropertyType}>
              <SelectTrigger id="listing-property-type" className="w-full">
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
          <div className="space-y-2">
            <Label>Landlord</Label>
            <CompanySelect
              value={landlordId}
              onChange={setLandlordId}
              defaultType="landlord"
              placeholder="Select or create landlord"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="listing-deal-type">Deal type</Label>
            <Select value={dealType} onValueChange={(v) => setDealType(v as Enums<'deal_type'>)}>
              <SelectTrigger id="listing-deal-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="lease">For lease</SelectItem>
                <SelectItem value="sale">For sale</SelectItem>
                <SelectItem value="both">Lease &amp; sale</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {(dealType === 'lease' || dealType === 'both') && (
              <div className="space-y-2">
                <Label htmlFor="listing-rate">Asking rate (PSF)</Label>
                <Input
                  id="listing-rate"
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                />
              </div>
            )}
            {(dealType === 'sale' || dealType === 'both') && (
              <div className="space-y-2">
                <Label htmlFor="listing-price">Asking price</Label>
                <Input
                  id="listing-price"
                  type="number"
                  inputMode="numeric"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </div>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="listing-source">Source</Label>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger id="listing-source" className="w-full">
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
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !address.trim()}>
              {pending ? 'Adding…' : 'Add property'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
