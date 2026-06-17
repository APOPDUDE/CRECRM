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
import { Textarea } from '@/components/ui/textarea'
import { CompanySelect } from '@/components/company-select'
import {
  useContacts,
  useUpdateContact,
  useUpsertContactByPhone,
  findContactByPhone,
} from '@/hooks/use-contacts'
import type { Contact } from '@/hooks/use-contacts'
import { friendlyDbError } from '@/lib/db-errors'
import { formatPhone, normalizePhone } from '@/lib/format'

interface ContactFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When set, the dialog edits this contact; otherwise it creates a new one. */
  contact?: Contact | null
  /** Default company attached to a newly created contact. */
  defaultCompanyId?: string | null
  /** Called with the new contact id right before the dialog closes (create only). */
  onCreated?: (id: string) => void
}

export function ContactFormDialog({
  open,
  onOpenChange,
  contact,
  defaultCompanyId,
  onCreated,
}: ContactFormDialogProps) {
  const upsertByPhone = useUpsertContactByPhone()
  const updateContact = useUpdateContact()
  const { data: contacts = [] } = useContacts()
  const pending = upsertByPhone.isPending || updateContact.isPending

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [title, setTitle] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (open) {
      setFirstName(contact?.first_name ?? '')
      setLastName(contact?.last_name ?? '')
      setTitle(contact?.title ?? '')
      setEmail(contact?.email ?? '')
      setPhone(contact?.phone ?? '')
      setCompanyId(contact?.company_id ?? defaultCompanyId ?? null)
      setNotes(contact?.notes ?? '')
    }
  }, [open, contact, defaultCompanyId])

  // When creating, a typed phone that matches an existing contact means we're
  // really editing that contact — phone is the identity, so we upsert.
  const matched = contact ? undefined : findContactByPhone(contacts, phone)

  const loadMatched = () => {
    if (!matched) return
    setFirstName(matched.first_name ?? '')
    setLastName(matched.last_name ?? '')
    setTitle(matched.title ?? '')
    setEmail(matched.email ?? '')
    setCompanyId(matched.company_id ?? null)
    setNotes(matched.notes ?? '')
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!normalizePhone(phone)) {
      toast.error('Enter a valid 10-digit phone number — it’s the contact’s unique ID')
      return
    }
    const values = {
      first_name: firstName.trim(),
      last_name: lastName.trim() || null,
      title: title.trim() || null,
      email: email.trim() || null,
      phone: formatPhone(phone),
      company_id: companyId,
      notes: notes.trim() || null,
    }
    const onError = (error: unknown) =>
      toast.error(friendlyDbError(error, 'Could not save contact'))

    if (contact) {
      updateContact.mutate(
        { id: contact.id, ...values },
        {
          onSuccess: () => {
            toast.success('Contact updated')
            onOpenChange(false)
          },
          onError,
        },
      )
    } else {
      upsertByPhone.mutate(values, {
        onSuccess: (saved) => {
          toast.success(matched ? 'Contact updated' : 'Contact created')
          onCreated?.(saved.id)
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
          <DialogTitle>{contact ? 'Edit contact' : 'Add contact'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="contact-first-name">First name</Label>
              <Input
                id="contact-first-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact-last-name">Last name</Label>
              <Input
                id="contact-last-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="contact-title">Title</Label>
            <Input
              id="contact-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="contact-email">Email</Label>
              <Input
                id="contact-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact-phone">Phone *</Label>
              <Input
                id="contact-phone"
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onBlur={() => setPhone((p) => formatPhone(p) ?? p)}
                placeholder="941-806-8432"
                required
              />
            </div>
          </div>
          {matched && (
            <div className="flex items-center justify-between gap-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
              <span>
                Existing contact: <strong>{[matched.first_name, matched.last_name].filter(Boolean).join(' ')}</strong>
                {matched.company?.name ? ` · ${matched.company.name}` : ''} — saving updates it.
              </span>
              <Button type="button" size="sm" variant="outline" className="h-7 shrink-0" onClick={loadMatched}>
                Load details
              </Button>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="contact-company">Company</Label>
            <CompanySelect value={companyId} onChange={setCompanyId} placeholder="Select company" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="contact-notes">Notes</Label>
            <Textarea
              id="contact-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
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
            <Button type="submit" disabled={pending || !firstName.trim()}>
              {pending ? 'Saving…' : contact ? 'Save changes' : 'Add contact'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
