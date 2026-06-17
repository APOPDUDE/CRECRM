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
import { ContactPhoneAutofill } from '@/components/contact-phone-autofill'
import { leadSourceLabels } from '@/components/source-badge'
import { useAuth } from '@/hooks/use-auth'
import {
  useContacts,
  useUpsertContactByPhone,
  findContactByPhone,
  contactNameOf,
} from '@/hooks/use-contacts'
import { useCreateTenantRep } from '@/hooks/use-tenant-reps'
import type { Enums } from '@/lib/database.types'
import { friendlyDbError } from '@/lib/db-errors'
import { formatPhone, normalizePhone } from '@/lib/format'

const NONE = '__none__'

interface AddTenantDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AddTenantDialog({ open, onOpenChange }: AddTenantDialogProps) {
  const { session } = useAuth()
  const createClient = useCreateTenantRep()
  const upsertContact = useUpsertContactByPhone()
  const { data: contacts = [] } = useContacts()
  const [pending, setPending] = useState(false)

  const [phone, setPhone] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [requirements, setRequirements] = useState('')
  const [source, setSource] = useState<string>(NONE)
  const [dealType, setDealType] = useState<Enums<'deal_type'>>('lease')

  useEffect(() => {
    if (open) {
      setPhone('')
      setFirstName('')
      setLastName('')
      setCompanyId(null)
      setRequirements('')
      setSource(NONE)
      setDealType('lease')
    }
  }, [open])

  // A typed phone matching an existing contact means we're editing that contact.
  const matched = findContactByPhone(contacts, phone)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!session?.user.id) {
      toast.error('You must be signed in to add a tenant')
      return
    }
    if (!normalizePhone(phone)) {
      toast.error('Enter a valid 10-digit phone number — it’s the contact’s unique ID')
      return
    }
    if (!firstName.trim()) {
      toast.error('A first name is required')
      return
    }
    setPending(true)
    try {
      const contact = await upsertContact.mutateAsync({
        first_name: firstName.trim(),
        last_name: lastName.trim() || null,
        phone: formatPhone(phone),
        company_id: companyId,
      })
      await createClient.mutateAsync({
        owner_id: session.user.id,
        contact_id: contact.id,
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
            <Label htmlFor="tenant-phone">Phone *</Label>
            <ContactPhoneAutofill
              id="tenant-phone"
              value={phone}
              onChange={setPhone}
              autoFocus
              onPick={(c) => {
                setPhone(formatPhone(c.phone) ?? '')
                setFirstName(c.first_name ?? '')
                setLastName(c.last_name ?? '')
                setCompanyId(c.company_id ?? null)
              }}
            />
            <p className="text-xs text-muted-foreground">
              The phone number is the contact’s unique ID — type it to find an existing contact.
            </p>
          </div>
          {matched && (
            <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
              Existing contact: <strong>{contactNameOf(matched)}</strong>
              {matched.company?.name ? ` · ${matched.company.name}` : ''} — saving updates it.
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="tenant-first">First name *</Label>
              <Input
                id="tenant-first"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tenant-last">Last name</Label>
              <Input
                id="tenant-last"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </div>
          </div>
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
            <Button type="submit" disabled={pending}>
              {pending ? 'Adding…' : 'Add tenant'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
