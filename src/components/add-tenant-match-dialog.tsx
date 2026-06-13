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
import { CompanySelect } from '@/components/company-select'
import { ContactSelect } from '@/components/contact-select'
import { leadSourceLabels } from '@/components/source-badge'
import { useCreateMatch } from '@/hooks/use-matches'
import type { Enums } from '@/lib/database.types'
import { friendlyDbError } from '@/lib/db-errors'

const NONE = '__none__'

interface AddTenantMatchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  listingId: string
  propertyId: string
}

export function AddTenantMatchDialog({
  open,
  onOpenChange,
  listingId,
  propertyId,
}: AddTenantMatchDialogProps) {
  const createMatch = useCreateMatch()

  const [companyId, setCompanyId] = useState<string | null>(null)
  const [contactId, setContactId] = useState<string | null>(null)
  const [source, setSource] = useState<string>(NONE)
  const [brokerId, setBrokerId] = useState<string | null>(null)
  const [inquiryDate, setInquiryDate] = useState('')

  useEffect(() => {
    if (open) {
      setCompanyId(null)
      setContactId(null)
      setSource(NONE)
      setBrokerId(null)
      setInquiryDate(format(new Date(), 'yyyy-MM-dd'))
    }
  }, [open])

  const isBroker = source === 'broker'

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    createMatch.mutate(
      {
        property_id: propertyId,
        listing_id: listingId,
        tenant_company_id: companyId,
        tenant_contact_id: contactId,
        source: source === NONE ? null : (source as Enums<'lead_source'>),
        broker_contact_id: isBroker ? brokerId : null,
        inquiry_date: inquiryDate || undefined,
      },
      {
        onSuccess: () => {
          toast.success('Tenant added')
          onOpenChange(false)
        },
        onError: (error) => toast.error(friendlyDbError(error, 'Could not add tenant')),
      },
    )
  }

  // a match with no tenant rep needs a contact (DB identity constraint); broker source needs a broker
  const canSubmit = !!contactId && (!isBroker || !!brokerId)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add tenant</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Company</Label>
            <CompanySelect
              value={companyId}
              onChange={setCompanyId}
              defaultType="tenant"
              placeholder="Select or create company"
            />
          </div>
          <div className="space-y-2">
            <Label>Contact</Label>
            <ContactSelect
              value={contactId}
              onChange={setContactId}
              companyId={companyId}
              placeholder="Select or create contact"
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
              {createMatch.isPending ? 'Adding…' : 'Add tenant'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
