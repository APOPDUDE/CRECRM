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
import { CompanySelect } from '@/components/company-select'
import { ContactSelect } from '@/components/contact-select'
import { leadSourceLabels } from '@/components/source-badge'
import { useAuth } from '@/hooks/use-auth'
import { useCreateTenantRep } from '@/hooks/use-tenant-reps'
import type { Enums } from '@/lib/database.types'
import { friendlyDbError } from '@/lib/db-errors'

const NONE = '__none__'

interface AddTenantDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AddTenantDialog({ open, onOpenChange }: AddTenantDialogProps) {
  const { session } = useAuth()
  const createClient = useCreateTenantRep()
  const [pending, setPending] = useState(false)

  const [companyId, setCompanyId] = useState<string | null>(null)
  const [contactId, setContactId] = useState<string | null>(null)
  const [requirements, setRequirements] = useState('')
  const [source, setSource] = useState<string>(NONE)
  const [dealType, setDealType] = useState<Enums<'deal_type'>>('lease')

  useEffect(() => {
    if (open) {
      setCompanyId(null)
      setContactId(null)
      setRequirements('')
      setSource(NONE)
      setDealType('lease')
    }
  }, [open])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!session?.user.id) {
      toast.error('You must be signed in to add a tenant')
      return
    }
    if (!contactId) {
      toast.error('A primary contact is required')
      return
    }
    setPending(true)
    try {
      await createClient.mutateAsync({
        owner_id: session.user.id,
        contact_id: contactId,
        company_id: companyId,
        status: 'searching',
        deal_type: dealType,
        must_haves: requirements.trim() || null,
        source: source === NONE ? null : (source as Enums<'lead_source'>),
      })
      toast.success('Tenant added')
      onOpenChange(false)
    } catch (error) {
      toast.error(friendlyDbError(error, 'Could not add tenant'))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add tenant</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Tenant company</Label>
            <CompanySelect
              value={companyId}
              onChange={setCompanyId}
              defaultType="tenant"
              placeholder="Select or create tenant"
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
            <Label htmlFor="tenant-deal-type">Looking to</Label>
            <Select value={dealType} onValueChange={(v) => setDealType(v as Enums<'deal_type'>)}>
              <SelectTrigger id="tenant-deal-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="lease">Lease space</SelectItem>
                <SelectItem value="sale">Buy space</SelectItem>
                <SelectItem value="both">Lease or buy</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tenant-requirements">Requirements</Label>
            <Input
              id="tenant-requirements"
              value={requirements}
              onChange={(e) => setRequirements(e.target.value)}
              placeholder="e.g. 50k SF, 24+ docks, Doral"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tenant-source">Source</Label>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger id="tenant-source" className="w-full">
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
            <Button type="submit" disabled={pending || !contactId}>
              {pending ? 'Adding…' : 'Add tenant'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
