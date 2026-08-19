import { useState } from 'react'
import { Link } from 'react-router-dom'
import { MapPin, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  useAddVerifiedContact,
  useOwnerContacts,
  useSetEmailVerified,
  useSetPhoneVerified,
  useOwnerConversations,
  useOwnerProperties,
  useOwnerRecord,
  useRemoveOwnerContact,
  useUpdateOwnerTags,
} from '@/hooks/use-owners'
import { AddNoteBox, ConversationLog } from '@/components/conversation-log'
import type { Property } from '@/hooks/use-properties'
import { cn } from '@/lib/utils'
import { formatDate } from '@/lib/dates'
import { formatPhone, normalizePhone } from '@/lib/format'
import { ghlContactUrl } from '@/lib/ghl'

/**
 * How we know this person, from `contacts.verified_by` — verification is one
 * person-level mark, and the OLD chip claimed the phone was verified no matter
 * which channel actually proved the human (an email reply rendered as a
 * verified NUMBER — the 1780 Calumet complaint). The label now names the
 * channel when it is known and stays a neutral "verified" when it is not.
 */
function verifiedLabel(verifiedBy: string | null): string {
  switch (verifiedBy) {
    case 'response':
      return 'replied'
    case 'client':
      return 'client'
    case 'ghl_va':
    case 'alex':
      return 'confirmed by call'
    default:
      return 'verified'
  }
}

/**
 * Who owns this building and whether we can actually reach them — the data-room answer,
 * right on the property page. The owning entity is a companies row (owners are retired);
 * its people are the contacts seated at it, and "verified" is `contacts.verified_at` —
 * Alex vouching is the same signal as the VA's tag. Removing a person only clears their
 * seat; the contact and its history stay in the CRM.
 */
export function PropertyOwnerCard({ property }: { property: Property }) {
  const companyId = property.owner_company_id
  const { data: contacts } = useOwnerContacts(companyId)
  const setPhone = useSetPhoneVerified()
  const setEmail = useSetEmailVerified()
  const { data: portfolio } = useOwnerProperties(companyId)
  const contactIds = (contacts ?? []).map((c) => c.id)
  const { data: comms } = useOwnerConversations(companyId, contactIds)
  const { data: ownerRec } = useOwnerRecord(companyId)
  const removeLink = useRemoveOwnerContact()
  const updateTags = useUpdateOwnerTags()
  const [addingTag, setAddingTag] = useState(false)
  const [tagDraft, setTagDraft] = useState('')

  const saveTags = (tags: string[]) => {
    if (!companyId) return
    updateTags.mutate(
      { ownerCompanyId: companyId, tags },
      { onError: (e) => toast.error(`Could not update tags: ${e.message}`) },
    )
  }

  const verified = (contacts ?? []).filter((c) => !!c.verified_at)
  const others = (contacts ?? []).filter((c) => !c.verified_at)
  // once the owner is verified, the unverified skip-trace lines are noise
  const shown = verified.length > 0 ? verified : others
  const portfolioCount = portfolio?.length ?? 0

  const remove = (contactId: string, name: string) => {
    if (!companyId) return
    if (!window.confirm(`Remove ${name} from this owner? The contact and its history stay in the CRM.`)) return
    removeLink.mutate(
      { contactId, ownerCompanyId: companyId },
      {
        onSuccess: () => toast.success(`${name} removed from owner`),
        onError: (e) => toast.error(`Could not remove: ${e.message}`),
      },
    )
  }

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-muted-foreground">Owner</h2>
      <div className="space-y-3 rounded-lg border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{ownerRec?.name ?? property.owner_name ?? 'Unknown owner'}</span>
          {verified.length > 0 ? (
            <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">
              Verified owner
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">Not verified</Badge>
          )}
          {/* outcome tags: written by the GHL flow, editable by Alex right here */}
          {(ownerRec?.tags ?? []).map((t) => (
            <Badge
              key={t}
              variant="outline"
              className={
                'gap-1 ' +
                (t === 'interested'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : t === 'not interested'
                    ? 'border-amber-200 bg-amber-50 text-amber-700'
                    : 'text-muted-foreground')
              }
            >
              {t}
              <button
                type="button"
                title="Remove tag"
                onClick={() => saveTags((ownerRec?.tags ?? []).filter((x) => x !== t))}
                className="opacity-50 hover:opacity-100"
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
          {companyId && !addingTag && (
            <button
              type="button"
              onClick={() => setAddingTag(true)}
              className="rounded border border-dashed px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted"
            >
              + tag
            </button>
          )}
          {addingTag && (
            <form
              className="flex items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault()
                const t = tagDraft.trim().toLowerCase()
                if (t) {
                  saveTags(Array.from(new Set([...(ownerRec?.tags ?? []), t])))
                }
                setTagDraft('')
                setAddingTag(false)
              }}
            >
              <Input
                autoFocus
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onBlur={() => setAddingTag(false)}
                placeholder="tag…"
                className="h-6 w-28 px-2 text-xs"
              />
            </form>
          )}
          {portfolioCount > 1 && companyId && (
            // A portfolio is a shape on a map before it is a number — one owner holding
            // eight parcels along the same corridor is a different conversation than eight
            // scattered ones, and you can only see that by looking.
            <Button asChild variant="outline" size="sm" className="h-7 px-2.5 text-xs font-normal">
              <Link to={`/properties?owner=${companyId}&view=map`}>
                <MapPin className="size-3.5" />
                Portfolio View ({portfolioCount})
              </Link>
            </Button>
          )}
        </div>
        {property.owner_mailing_address && (
          <p className="text-xs text-muted-foreground">
            Mailing: {property.owner_mailing_address}
          </p>
        )}

        {shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No contacts yet — add a verified number below, or export this property for
            skip-tracing.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {shown.map((ct) => {
              const name = [ct.first_name, ct.last_name].filter(Boolean).join(' ') || 'Unknown'
              return (
                <li key={ct.id} className="flex flex-wrap items-center gap-x-2 text-sm">
                  <Link to={`/contacts/${ct.id}`} className="font-medium hover:underline">
                    {name}
                  </Link>
                  {/* Verification belongs to the CHANNEL, not the person: a confirmed number
                      and a proven email are different facts. Each badge is the control that
                      sets it — click to flip, because the person who just made the call is
                      the one who knows. */}
                  {ct.phone && (
                    <span className="inline-flex items-center gap-1">
                      <a
                        href={ct.ghl_contact_id ? ghlContactUrl(ct.ghl_contact_id) : `tel:${ct.phone}`}
                        {...(ct.ghl_contact_id
                          ? { target: '_blank', rel: 'noopener noreferrer', title: 'Call via GHL' }
                          : {})}
                        className={cn(
                          'hover:underline',
                          ct.verified_at ? 'font-medium text-blue-700' : 'text-muted-foreground',
                        )}
                      >
                        {formatPhone(ct.phone) ?? ct.phone}
                      </a>
                      <button
                        type="button"
                        disabled={setPhone.isPending}
                        title={
                          ct.verified_at
                            ? `Verified ${formatDate(ct.verified_at)} (${verifiedLabel(ct.verified_by)}) — click to unverify`
                            : 'Click to mark this person verified'
                        }
                        onClick={() =>
                          setPhone.mutate({
                            contactId: ct.id,
                            verified: !ct.verified_at,
                          })
                        }
                        className={cn(
                          'rounded-full border px-1.5 py-px text-[10px] transition-colors',
                          ct.verified_at
                            ? 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'
                            : 'border-transparent text-muted-foreground hover:border-border hover:bg-accent',
                        )}
                      >
                        {ct.verified_at ? verifiedLabel(ct.verified_by) : 'unverified'}
                      </button>
                    </span>
                  )}
                  {ct.email && (
                    <span className="inline-flex items-center gap-1">
                      <a
                        href={`mailto:${ct.email}`}
                        className={cn(
                          'text-xs hover:underline',
                          ct.email_verified_at
                            ? 'font-medium text-teal-700'
                            : 'text-muted-foreground',
                        )}
                      >
                        {ct.email}
                      </a>
                      <button
                        type="button"
                        disabled={setEmail.isPending}
                        title={
                          ct.email_verified_at
                            ? `Verified ${formatDate(ct.email_verified_at)} — click to unverify`
                            : 'Click to mark this email verified'
                        }
                        onClick={() =>
                          setEmail.mutate({
                            contactId: ct.id,
                            verified: !ct.email_verified_at,
                          })
                        }
                        className={cn(
                          'rounded-full border px-1.5 py-px text-[10px] transition-colors',
                          ct.email_verified_at
                            ? 'border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100'
                            : 'border-transparent text-muted-foreground hover:border-border hover:bg-accent',
                        )}
                      >
                        {ct.email_verified_at ? 'verified' : 'unverified'}
                      </button>
                    </span>
                  )}
                  {ct.do_not_call && (
                    <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700 text-[10px]">
                      DNC
                    </Badge>
                  )}
                  <button
                    type="button"
                    title="Remove from this owner"
                    onClick={() => remove(ct.id, name)}
                    className="ml-auto rounded p-0.5 text-muted-foreground hover:bg-red-50 hover:text-red-600"
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        <AddContactForm property={property} />

        <div className="space-y-2 border-t pt-3">
          <h3 className="text-xs font-medium text-muted-foreground">Conversations</h3>
          <AddNoteBox
            contactId={verified[0]?.id ?? contactIds[0] ?? null}
            ownerCompanyId={companyId}
            propertyId={property.id}
          />
          <ConversationLog comms={comms ?? []} />
        </div>
      </div>
    </section>
  )
}

/** Inline "add a verified number" — the phone is the identity, the name makes it callable. */
function AddContactForm({ property }: { property: Property }) {
  const [open, setOpen] = useState(false)
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const add = useAddVerifiedContact()

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        Add verified contact
      </Button>
    )
  }

  const save = () => {
    if (!first.trim()) {
      toast.error('First name is required')
      return
    }
    if (!normalizePhone(phone)) {
      toast.error('A valid 10-digit phone is required')
      return
    }
    add.mutate(
      {
        property,
        first: first.trim(),
        last: last.trim() || null,
        phone: phone.trim(),
        email: email.trim() || null,
      },
      {
        onSuccess: () => {
          toast.success('Verified contact added')
          setOpen(false)
          setFirst('')
          setLast('')
          setPhone('')
          setEmail('')
        },
        onError: (e) => toast.error(`Could not add contact: ${e.message}`),
      },
    )
  }

  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-3">
      <div className="grid grid-cols-2 gap-2">
        <Input placeholder="First name" value={first} onChange={(e) => setFirst(e.target.value)} />
        <Input placeholder="Last name" value={last} onChange={(e) => setLast(e.target.value)} />
        <Input placeholder="Phone (required)" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <Input placeholder="Email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={add.isPending}>
          Save as verified
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
