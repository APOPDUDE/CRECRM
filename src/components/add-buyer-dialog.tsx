import { useState } from 'react'
import { useResetOn } from '@/hooks/use-reset-on'
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
import { Textarea } from '@/components/ui/textarea'
import { CompanySelect } from '@/components/company-select'
import { ContactSelect } from '@/components/contact-select'
import { ConversationLog } from '@/components/conversation-log'
import { leadSourceLabels } from '@/lib/labels'
import { BuyerCriteriaFields } from '@/components/buyer-criteria-fields'
import { buyerCriteriaToRow, emptyBuyerCriteria, type BuyerCriteria } from '@/lib/buyer-criteria'
import { Building2, Plus, X } from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'
import { useContactConversations } from '@/hooks/use-communications'
import { useUpsertContactByPhone } from '@/hooks/use-contacts'
import { usePropertySearch, type ParcelSearchResult } from '@/hooks/use-listing-parcels'
import { useCreateMatch } from '@/hooks/use-matches'
import { useCreateTenantRep } from '@/hooks/use-tenant-reps'
import type { Enums } from '@/lib/database.types'
import { friendlyDbError } from '@/lib/db-errors'
import { formatPhone } from '@/lib/format'

const NONE = '__none__'

/**
 * Add a buyer to the roster. A buyer is a client with deal_type 'sale' — the same record
 * a tenant rep uses, so the moment they go after a property the existing deal board works.
 */
export function AddBuyerDialog({
  open,
  onOpenChange,
  prefill,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Seed the form when the buyer came from somewhere that already knows who they are —
   * today that's the GHL buyer-tag queue on the Buyers page.
   */
  prefill?: {
    contactId?: string | null
    companyId?: string | null
    /** Shown on the contact picker, which can't always resolve a name from its capped list. */
    contactLabel?: string | null
    /**
     * Identity captured at intake time (the GHL buyer tag) when no CRM contact exists yet.
     * Submitting creates the contact from this automatically — filling in a buyer must
     * never mean retyping a name and phone the intake already knows.
     */
    newContact?: {
      firstName: string | null
      lastName: string | null
      phone: string | null
      email: string | null
    } | null
    /** What the lead already told us (the Buyer rep push from a lead seeds these). */
    notes?: string | null
    source?: Enums<'lead_source'> | null
  } | null
  /** The client + the contact it hangs on, so a caller can link its queue entry to both. */
  onCreated?: (clientId: string, contactId: string) => void
}) {
  const { session } = useAuth()
  const userId = session?.user.id
  const createClient = useCreateTenantRep()
  const upsertContact = useUpsertContactByPhone()

  const createMatch = useCreateMatch()

  const [contactId, setContactId] = useState<string | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [source, setSource] = useState<string>(NONE)
  const [capRate, setCapRate] = useState('')
  const [notes, setNotes] = useState('')
  const [criteria, setCriteria] = useState<BuyerCriteria>(emptyBuyerCriteria)
  // The property whose sign/listing/text generated this buyer. Picking one creates a
  // pursuit on submit, so they land on that property's board and their own in-play list.
  const [propSearch, setPropSearch] = useState('')
  const [inquiredProp, setInquiredProp] = useState<Pick<
    ParcelSearchResult,
    'id' | 'address' | 'city'
  > | null>(null)
  const propResults = usePropertySearch(propSearch)

  useResetOn([open, prefill?.contactId, prefill?.companyId], () => {
    if (!open) return
    setContactId(prefill?.contactId ?? null)
    setCompanyId(prefill?.companyId ?? null)
    setSource(prefill?.source ?? NONE)
    setCapRate('')
    setNotes(prefill?.notes ?? '')
    setCriteria(emptyBuyerCriteria())
    setPropSearch('')
    setInquiredProp(null)
  })

  // The calls, texts and VA notes already logged against this person — shown in the form
  // so filling in criteria doesn't mean remembering the conversation cold.
  const conversations = useContactConversations(contactId ?? undefined)

  const newContact = prefill?.newContact ?? null
  // The contacts table demands an identity (phone or email) — without one the intake
  // can't become a contact automatically and the picker has to be used.
  const canCreateFromIntake = !!newContact && !!(newContact.phone || newContact.email)
  const newContactLabel = newContact
    ? [newContact.firstName, newContact.lastName].filter(Boolean).join(' ') ||
      formatPhone(newContact.phone) ||
      newContact.email ||
      null
    : null

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!userId) return
    if (!contactId && !canCreateFromIntake) return

    // No contact picked but the intake knows who this is: mint the contact right here,
    // seated at whatever company was picked (or created) above. Keyed by phone, so if a
    // contact with this number appeared since the intake, it is updated, not duplicated.
    let cid = contactId
    if (!cid && newContact) {
      try {
        const created = await upsertContact.mutateAsync({
          first_name:
            newContact.firstName?.trim() ||
            formatPhone(newContact.phone) ||
            newContact.email ||
            'Unknown',
          last_name: newContact.lastName?.trim() || null,
          phone: newContact.phone || null,
          email: newContact.email || null,
          company_id: companyId,
          source: 'ghl',
        })
        cid = created.id
      } catch (error) {
        toast.error(friendlyDbError(error, 'Could not create the contact'))
        return
      }
    }
    if (!cid) return
    const finalContactId = cid

    createClient.mutate(
      {
        owner_id: userId,
        contact_id: finalContactId,
        company_id: companyId,
        is_rep: true,
        deal_type: 'sale',
        status: 'prospect',
        source: source === NONE ? null : (source as Enums<'lead_source'>),
        cap_rate_min: capRate.trim() === '' ? null : Number(capRate),
        must_haves: notes.trim() || null,
        ...buyerCriteriaToRow(criteria),
      },
      {
        onSuccess: (created) => {
          toast.success('Buyer added')
          // The inquiry that brought them in becomes a pursuit: a card on that property's
          // board and a row in the buyer's in-play list. Fire-and-forget so a pursuit
          // hiccup never blocks the buyer that just saved.
          if (created?.id && inquiredProp) {
            createMatch.mutate(
              {
                owner_id: userId,
                client_id: created.id,
                property_id: inquiredProp.id,
                stage: 'inquiring',
              },
              {
                onError: () =>
                  toast.error(
                    `Buyer saved, but could not log the inquiry on ${inquiredProp.address}`,
                  ),
              },
            )
          }
          if (created?.id) onCreated?.(created.id, finalContactId)
          onOpenChange(false)
        },
        onError: (error) => toast.error(friendlyDbError(error, 'Could not add buyer')),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add buyer</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Contact</Label>
            <ContactSelect
              value={contactId}
              onChange={setContactId}
              companyId={companyId ?? undefined}
              placeholder={
                !contactId && canCreateFromIntake && newContactLabel
                  ? `New contact: ${newContactLabel}`
                  : 'Select or create contact'
              }
              fallbackLabel={contactId && contactId === prefill?.contactId ? prefill?.contactLabel : null}
            />
            {!contactId && newContact && (
              <p className="text-xs text-muted-foreground">
                {canCreateFromIntake
                  ? `“${newContactLabel}” isn't a contact yet — they'll be created automatically when you add the buyer.`
                  : 'This intake has no phone or email, so pick or create the contact by hand.'}
              </p>
            )}
          </div>

          {contactId && (conversations.data?.length ?? 0) > 0 && (
            <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
              <p className="text-xs font-medium text-muted-foreground">
                Recent conversations with this contact
              </p>
              <ConversationLog comms={conversations.data!} />
            </div>
          )}
          <div className="space-y-2">
            <Label>Company</Label>
            <CompanySelect
              value={companyId}
              onChange={setCompanyId}
              defaultType="other"
              placeholder="Select or create company"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="add-buyer-prop">Inquired about property</Label>
            {inquiredProp ? (
              <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-2 py-1.5 text-sm">
                <Building2 className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">
                  {inquiredProp.address}
                  {inquiredProp.city ? `, ${inquiredProp.city}` : ''}
                </span>
                <button
                  type="button"
                  aria-label="Clear property"
                  onClick={() => setInquiredProp(null)}
                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ) : (
              <>
                <Input
                  id="add-buyer-prop"
                  value={propSearch}
                  onChange={(e) => setPropSearch(e.target.value)}
                  placeholder="Search the property they called about…"
                  autoComplete="off"
                />
                {(propResults.data?.length ?? 0) > 0 && (
                  <ul className="divide-y overflow-hidden rounded-lg border">
                    {propResults.data!.slice(0, 6).map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setInquiredProp(p)
                            setPropSearch('')
                          }}
                          className="flex w-full items-center gap-2 p-2 text-left text-sm hover:bg-accent/50"
                        >
                          <Plus className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate">
                            {p.address}
                            {p.city ? `, ${p.city}` : ''}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
            <p className="text-xs text-muted-foreground">
              Optional — logs them as an inquiry on that property's board and adds it to
              their list.
            </p>
          </div>

          <BuyerCriteriaFields value={criteria} onChange={setCriteria} idPrefix="add-buyer" />

          <div className="space-y-2">
            <Label htmlFor="add-buyer-cap">Min cap rate (%)</Label>
            <Input
              id="add-buyer-cap"
              type="number"
              inputMode="decimal"
              step="0.01"
              value={capRate}
              onChange={(e) => setCapRate(e.target.value)}
              placeholder="e.g. 6.5"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="add-buyer-source">Source</Label>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger id="add-buyer-source" className="w-full">
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

          <div className="space-y-2">
            <Label htmlFor="add-buyer-notes">Notes</Label>
            <Textarea
              id="add-buyer-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Tenancy, hold period, debt, whatever matters when you call them…"
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={createClient.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                createClient.isPending ||
                upsertContact.isPending ||
                (!contactId && !canCreateFromIntake)
              }
            >
              {createClient.isPending || upsertContact.isPending ? 'Adding…' : 'Add buyer'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
