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

/**
 * Who owns this building and whether we can actually reach them — the data-room answer,
 * right on the property page. Contacts added here count as VERIFIED (Alex vouching is the
 * same signal as the VA's tag); removing a link never deletes the contact or its history.
 */
export function PropertyOwnerCard({ property }: { property: Property }) {
  const ownerId = property.owner_id
  const { data: contacts } = useOwnerContacts(ownerId)
  const { data: portfolio } = useOwnerProperties(ownerId)
  const contactIds = (contacts ?? []).map((c) => c.contact?.id).filter((v): v is string => !!v)
  const { data: comms } = useOwnerConversations(ownerId, contactIds)
  const { data: ownerRec } = useOwnerRecord(ownerId)
  const removeLink = useRemoveOwnerContact()
  const updateTags = useUpdateOwnerTags()
  const [addingTag, setAddingTag] = useState(false)
  const [tagDraft, setTagDraft] = useState('')

  const saveTags = (tags: string[]) => {
    if (!ownerId) return
    updateTags.mutate(
      { ownerId, tags },
      { onError: (e) => toast.error(`Could not update tags: ${e.message}`) },
    )
  }

  const verified = (contacts ?? []).filter((c) => c.confidence === 'confirmed')
  const others = (contacts ?? []).filter((c) => c.confidence !== 'confirmed')
  // once the owner is verified, the unverified skip-trace lines are noise
  const shown = verified.length > 0 ? verified : others
  const portfolioCount = portfolio?.length ?? 0

  const remove = (linkId: string, name: string) => {
    if (!ownerId) return
    if (!window.confirm(`Remove ${name} from this owner? The contact and its history stay in the CRM.`)) return
    removeLink.mutate(
      { linkId, ownerId },
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
          <span className="font-medium">{property.owner_name ?? 'Unknown owner'}</span>
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
          {ownerId && !addingTag && (
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
          {portfolioCount > 1 && ownerId && (
            // A portfolio is a shape on a map before it is a number — one owner holding
            // eight parcels along the same corridor is a different conversation than eight
            // scattered ones, and you can only see that by looking.
            <Button asChild variant="outline" size="sm" className="h-7 px-2.5 text-xs font-normal">
              <Link to={`/properties?owner=${ownerId}&view=map`}>
                <MapPin className="size-3.5" />
                See all {portfolioCount} on the map
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
            {shown.map((oc) => {
              const name =
                [oc.contact?.first_name, oc.contact?.last_name].filter(Boolean).join(' ') ||
                'Unknown'
              return (
                <li key={oc.id} className="flex flex-wrap items-center gap-x-2 text-sm">
                  <Link to={`/contacts/${oc.contact?.id}`} className="font-medium hover:underline">
                    {name}
                  </Link>
                  {/* Verification belongs to the CHANNEL, not the person: a confirmed number
                      and a replied-to email are different facts, and one row-level badge
                      forced them into a single yes/no that answered neither. */}
                  {oc.contact?.phone && (
                    <span className="inline-flex items-center gap-1">
                      <a
                        href={`tel:${oc.contact.phone}`}
                        className={cn(
                          'hover:underline',
                          oc.confidence === 'confirmed'
                            ? 'font-medium text-blue-700'
                            : 'text-muted-foreground',
                        )}
                      >
                        {formatPhone(oc.contact.phone) ?? oc.contact.phone}
                      </a>
                      {oc.confidence === 'confirmed' ? (
                        <Badge
                          variant="outline"
                          className="border-blue-200 bg-blue-50 text-[10px] text-blue-700"
                          title={oc.verified_at ? `Confirmed ${formatDate(oc.verified_at)}` : 'Confirmed on a call'}
                        >
                          spoke to
                        </Badge>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">{oc.confidence}</span>
                      )}
                    </span>
                  )}
                  {oc.contact?.email && (
                    <span className="inline-flex items-center gap-1">
                      <a
                        href={`mailto:${oc.contact.email}`}
                        className={cn(
                          'text-xs hover:underline',
                          oc.contact.email_verified_at
                            ? 'font-medium text-teal-700'
                            : 'text-muted-foreground',
                        )}
                      >
                        {oc.contact.email}
                      </a>
                      {oc.contact.email_verified_at && (
                        <Badge
                          variant="outline"
                          className="border-teal-200 bg-teal-50 text-[10px] text-teal-700"
                          title={`Replied ${formatDate(oc.contact.email_verified_at)}`}
                        >
                          replied
                        </Badge>
                      )}
                    </span>
                  )}
                  {oc.contact?.do_not_call && (
                    <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700 text-[10px]">
                      DNC
                    </Badge>
                  )}
                  <button
                    type="button"
                    title="Remove from this owner"
                    onClick={() => remove(oc.id, name)}
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
            contactId={verified[0]?.contact?.id ?? contactIds[0] ?? null}
            ownerId={ownerId}
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
