import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BadgeCheck, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ContactFormDialog } from '@/components/contact-form-dialog'
import { useCompanyContacts, useCompanyLeases } from '@/hooks/use-companies'
import { useUpdateContact } from '@/hooks/use-contacts'
import { formatPhone, formatPsf, formatSf } from '@/lib/format'
import { formatDate } from '@/lib/dates'
import type { Enums } from '@/lib/database.types'

const DM_LABEL: Record<Enums<'decision_maker_status'>, string> = {
  none: 'Contact',
  suspected: 'Suspected DM',
  verified: 'Verified DM',
}

/**
 * The people at this company, decision makers first.
 *
 * The three-state select is the whole workflow: 'suspected' is a title on LinkedIn,
 * 'verified' means Alex talked to them and they make the real-estate call. The lease
 * map's decision-maker filter reads ONLY 'verified' — same philosophy as the owner
 * lens, where a name on a county record is not the same as a number that answers.
 */
function ContactsSection({ companyId }: { companyId: string }) {
  const { data: contacts = [], isLoading } = useCompanyContacts(companyId)
  const updateContact = useUpdateContact()
  const [addOpen, setAddOpen] = useState(false)

  const setDm = (id: string, decision_maker: Enums<'decision_maker_status'>) =>
    updateContact.mutate(
      { id, decision_maker },
      {
        onSuccess: () =>
          toast.success(
            decision_maker === 'verified'
              ? 'Marked as verified decision maker'
              : decision_maker === 'suspected'
                ? 'Marked as suspected decision maker'
                : 'Decision-maker flag removed',
          ),
        onError: () => toast.error('Could not update the contact'),
      },
    )

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">
          Contacts {contacts.length > 0 && `(${contacts.length})`}
        </h2>
        <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="size-4" />
          Add contact
        </Button>
      </div>
      {isLoading ? null : contacts.length === 0 ? (
        <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          No one at this company yet. Add the person who makes the real-estate call.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {contacts.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <Link
                    to={`/contacts/${c.id}`}
                    className="truncate text-sm font-medium hover:text-primary hover:underline"
                  >
                    {[c.first_name, c.last_name].filter(Boolean).join(' ')}
                  </Link>
                  {c.decision_maker === 'verified' && (
                    <BadgeCheck className="size-4 shrink-0 text-blue-600" aria-label="Verified decision maker" />
                  )}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {[c.title, formatPhone(c.phone), c.email].filter(Boolean).join(' · ') || '—'}
                </div>
              </div>
              <Select
                value={c.decision_maker}
                onValueChange={(v) => setDm(c.id, v as Enums<'decision_maker_status'>)}
              >
                <SelectTrigger className="h-8 w-36 shrink-0 text-xs">
                  <SelectValue>{DM_LABEL[c.decision_maker]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Contact</SelectItem>
                  <SelectItem value="suspected">Suspected DM</SelectItem>
                  <SelectItem value="verified">Verified DM</SelectItem>
                </SelectContent>
              </Select>
            </li>
          ))}
        </ul>
      )}
      <ContactFormDialog open={addOpen} onOpenChange={setAddOpen} defaultCompanyId={companyId} />
    </section>
  )
}

/** This tenant's footprint across the book — every building they hold, soonest expiry first. */
function LeasesSection({ companyId }: { companyId: string }) {
  const { data: leases = [] } = useCompanyLeases(companyId)
  if (leases.length === 0) return null

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-muted-foreground">Leases ({leases.length})</h2>
      <ul className="divide-y rounded-lg border">
        {leases.map((l) => {
          const expired = l.expiration_date != null && l.expiration_date < new Date().toISOString().slice(0, 10)
          return (
            <li key={l.id} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <Link
                  to={`/properties/${l.property_id}`}
                  className="truncate text-sm font-medium hover:text-primary hover:underline"
                >
                  {l.property?.address ?? 'Property'}
                </Link>
                <div className="truncate text-xs text-muted-foreground">
                  {[
                    [l.property?.city, l.property?.state].filter(Boolean).join(', ') || null,
                    formatSf(l.sf),
                    formatPsf(l.executed_lease_rate_psf),
                    l.lease_structure,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
              <Badge
                variant="outline"
                className={
                  expired
                    ? 'shrink-0 border-red-200 bg-red-50 text-red-700'
                    : 'shrink-0 border-emerald-200 bg-emerald-50 text-emerald-700'
                }
              >
                {l.expiration_date
                  ? `${expired ? 'Expired' : 'Expires'} ${formatDate(l.expiration_date)}`
                  : 'No expiry on file'}
              </Badge>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** The company page's association views: who works there, and what space they hold. */
export function CompanyPeopleAndLeases({ companyId }: { companyId: string }) {
  return (
    <div className="space-y-6">
      <ContactsSection companyId={companyId} />
      <LeasesSection companyId={companyId} />
    </div>
  )
}
