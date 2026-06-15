import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { useUpdateListing } from '@/hooks/use-listings'
import type { ListingDetail } from '@/hooks/use-listings'
import { useUpdateProperty } from '@/hooks/use-properties'
import type { Enums, TablesUpdate } from '@/lib/database.types'

interface ListingTermsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  listing: ListingDetail
}

const numOrNull = (v: string): number | null => (v.trim() === '' ? null : Number(v))

/** Edit the listing-level economics that feed the About panel and the commission calculator. */
export function ListingTermsDialog({ open, onOpenChange, listing }: ListingTermsDialogProps) {
  const queryClient = useQueryClient()
  const updateListing = useUpdateListing()
  const updateProperty = useUpdateProperty()
  const pending = updateListing.isPending || updateProperty.isPending
  const showLease = listing.deal_type === 'lease' || listing.deal_type === 'both'
  const showSale = listing.deal_type === 'sale' || listing.deal_type === 'both'

  const [buildingSf, setBuildingSf] = useState('')
  const [rate, setRate] = useState('')
  const [price, setPrice] = useState('')
  const [opex, setOpex] = useState('')
  const [structure, setStructure] = useState<Enums<'lease_structure'> | ''>('')
  const [commission, setCommission] = useState('')
  const [coBroke, setCoBroke] = useState('')
  const [expiration, setExpiration] = useState('')

  useEffect(() => {
    if (!open) return
    setBuildingSf(listing.property?.building_sf?.toString() ?? '')
    setRate(listing.asking_rate_psf?.toString() ?? '')
    setPrice(listing.asking_price?.toString() ?? '')
    setOpex(listing.opex_psf?.toString() ?? '')
    setStructure(listing.lease_structure ?? '')
    setCommission(listing.commission_pct?.toString() ?? '')
    setCoBroke(listing.co_broke_split_pct?.toString() ?? '')
    setExpiration(listing.listing_expiration ?? '')
  }, [open, listing])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const patch: TablesUpdate<'listings'> & { id: string } = {
      id: listing.id,
      commission_pct: numOrNull(commission),
      co_broke_split_pct: numOrNull(coBroke),
      listing_expiration: expiration || null,
    }
    if (showSale) {
      patch.asking_price = numOrNull(price)
    }
    if (showLease) {
      patch.asking_rate_psf = numOrNull(rate)
      patch.opex_psf = numOrNull(opex)
      patch.lease_structure = structure || null
    }
    try {
      await updateListing.mutateAsync(patch)
      // Building SF lives on the property — update it too so the commission can compute.
      const nextSf = buildingSf.trim() === '' ? null : Math.round(Number(buildingSf))
      if (listing.property_id && nextSf !== (listing.property?.building_sf ?? null)) {
        await updateProperty.mutateAsync({ id: listing.property_id, building_sf: nextSf })
      }
      queryClient.invalidateQueries({ queryKey: ['listing', listing.id] })
      toast.success('Terms saved')
      onOpenChange(false)
    } catch {
      toast.error('Could not save terms')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Listing terms</DialogTitle>
          <DialogDescription>
            Used on the About panel and to estimate the commission on executed deals.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="terms-sf">Building SF</Label>
            <Input
              id="terms-sf"
              type="number"
              inputMode="numeric"
              value={buildingSf}
              onChange={(e) => setBuildingSf(e.target.value)}
              placeholder="e.g. 25000"
            />
            <p className="text-xs text-muted-foreground">Needed to estimate the lease commission.</p>
          </div>
          {showSale && (
            <div className="space-y-2">
              <Label htmlFor="terms-price">Asking price</Label>
              <Input
                id="terms-price"
                type="number"
                inputMode="numeric"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="$"
              />
            </div>
          )}
          {showLease && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="terms-rate">Asking rate $/SF</Label>
                <Input
                  id="terms-rate"
                  type="number"
                  inputMode="decimal"
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="terms-opex">OpEx $/SF</Label>
                <Input
                  id="terms-opex"
                  type="number"
                  inputMode="decimal"
                  value={opex}
                  onChange={(e) => setOpex(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="terms-structure">Structure</Label>
                <Select
                  value={structure}
                  onValueChange={(v) => setStructure(v as Enums<'lease_structure'>)}
                >
                  <SelectTrigger id="terms-structure" className="w-full">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NNN">NNN</SelectItem>
                    <SelectItem value="NN">NN</SelectItem>
                    <SelectItem value="MG">MG</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="terms-commission">Commission %</Label>
              <Input
                id="terms-commission"
                type="number"
                inputMode="decimal"
                value={commission}
                onChange={(e) => setCommission(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="terms-cobroke">Co-broke split %</Label>
              <Input
                id="terms-cobroke"
                type="number"
                inputMode="decimal"
                value={coBroke}
                onChange={(e) => setCoBroke(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="terms-expiration">Listing expiration</Label>
            <Input
              id="terms-expiration"
              type="date"
              value={expiration}
              onChange={(e) => setExpiration(e.target.value)}
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
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Save terms'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
