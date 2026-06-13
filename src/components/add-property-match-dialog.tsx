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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ContactSelect } from '@/components/contact-select'
import { PropertySelect } from '@/components/property-select'
import { leadSourceLabels } from '@/components/source-badge'
import { useCreateMatch } from '@/hooks/use-matches'
import type { TenantRepDetail } from '@/hooks/use-tenant-reps'
import type { Enums } from '@/lib/database.types'
import { friendlyDbError } from '@/lib/db-errors'
import { supabase } from '@/lib/supabase'

const NONE = '__none__'

interface AddPropertyMatchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tenantRep: TenantRepDetail
}

export function AddPropertyMatchDialog({
  open,
  onOpenChange,
  tenantRep,
}: AddPropertyMatchDialogProps) {
  const createMatch = useCreateMatch()

  const [propertyId, setPropertyId] = useState<string | null>(null)
  const [source, setSource] = useState<string>(NONE)
  const [brokerId, setBrokerId] = useState<string | null>(null)
  const [inquiryDate, setInquiryDate] = useState('')

  useEffect(() => {
    if (open) {
      setPropertyId(null)
      setSource(NONE)
      setBrokerId(null)
      setInquiryDate(format(new Date(), 'yyyy-MM-dd'))
    }
  }, [open])

  const isBroker = source === 'broker'

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!propertyId) return

    // If this property is one of my active listings, link it so the match
    // becomes dual-sided and the card shows the "My listing" badge.
    let listingId: string | null = null
    // link to the most recent active listing on this property (deterministic if several)
    const { data: listings } = await supabase
      .from('listings')
      .select('id')
      .eq('property_id', propertyId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
    if (listings && listings.length > 0) listingId = listings[0].id

    createMatch.mutate(
      {
        property_id: propertyId,
        tenant_rep_id: tenantRep.id,
        listing_id: listingId,
        tenant_company_id: tenantRep.tenant_company_id,
        tenant_contact_id: tenantRep.tenant_contact_id,
        source: source === NONE ? null : (source as Enums<'lead_source'>),
        broker_contact_id: isBroker ? brokerId : null,
        inquiry_date: inquiryDate || undefined,
      },
      {
        onSuccess: () => {
          toast.success('Property added')
          onOpenChange(false)
        },
        onError: (error) => toast.error(friendlyDbError(error, 'Could not add property')),
      },
    )
  }

  // tenant_rep_id satisfies the match identity constraint; broker source needs a broker
  const canSubmit = !!propertyId && (!isBroker || !!brokerId)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add property</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Property</Label>
            <PropertySelect
              value={propertyId}
              onChange={setPropertyId}
              placeholder="Search or create property"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="match-source">Source</Label>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger id="match-source" className="w-full">
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
          {isBroker && (
            <div className="space-y-2">
              <Label>Referring broker</Label>
              <ContactSelect
                value={brokerId}
                onChange={setBrokerId}
                placeholder="Select or create broker"
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="match-inquiry-date">Inquiry date</Label>
            <Input
              id="match-inquiry-date"
              type="date"
              value={inquiryDate}
              onChange={(e) => setInquiryDate(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={createMatch.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={createMatch.isPending || !canSubmit}>
              {createMatch.isPending ? 'Adding…' : 'Add property'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
