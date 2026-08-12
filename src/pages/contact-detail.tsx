import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Pencil, ShoppingBag, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ContactFormDialog } from '@/components/contact-form-dialog'
import { contactName } from '@/pages/contacts'
import { useContact } from '@/hooks/use-contacts'
import {
  useBuyerContactIds,
  useMarkContactAsBuyer,
  usePendingBuyerIntakeForContact,
} from '@/hooks/use-buyers'
import { useVerifiedContactIds } from '@/hooks/use-owners'
import { BuyerBadge } from '@/components/buyer-badge'
import { VerifiedBadge } from '@/components/verified-badge'
import { friendlyDbError } from '@/lib/db-errors'
import { useSetBreadcrumb } from '@/hooks/use-breadcrumb'
import { useBackTo } from '@/hooks/use-back-to'
import { useContactConversations } from '@/hooks/use-communications'
import { AddNoteBox, ConversationLog } from '@/components/conversation-log'
import { ContactAssociations } from '@/components/contact-associations'
import { ContactTasks } from '@/components/contact-tasks'
import { TaskFocusBanner } from '@/components/task-focus-banner'
import { EmailVerifiedBadge } from '@/components/verified-badge'

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null
  return (
    <div>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{value}</dd>
    </div>
  )
}

export function ContactDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: contact, isLoading, isError } = useContact(id)
  const [editOpen, setEditOpen] = useState(false)
  const { data: comms } = useContactConversations(id)
  const { data: pendingIntake } = usePendingBuyerIntakeForContact(id)
  const { data: buyerIds } = useBuyerContactIds()
  const { data: verifiedIds } = useVerifiedContactIds()
  const markAsBuyer = useMarkContactAsBuyer()
  const buyerClientId = id ? buyerIds?.buyers.get(id) : undefined

  const goBack = useBackTo('/contacts')

  useSetBreadcrumb(contact ? contactName(contact) : undefined)

  // Marking raises the question and stops there — the criteria live on the Buyers page, and
  // filling them in is what creates the client.
  const handleMarkAsBuyer = () => {
    if (!contact) return
    markAsBuyer.mutate(contact.id, {
      onSuccess: (result) => {
        if (result.status === 'already_a_client') {
          toast.info(`${contactName(contact)} is already a buyer`, {
            action: {
              label: 'Open',
              onClick: () => navigate(`/tenant-rep/${result.client_id}`),
            },
          })
          return
        }
        toast.success(
          result.already
            ? `${contactName(contact)} is already waiting on the buyers page`
            : `${contactName(contact)} added — fill in what they're buying`,
          { action: { label: 'Buyers', onClick: () => navigate('/pipelines/buyers') } },
        )
      },
      onError: (error) => toast.error(friendlyDbError(error, 'Could not mark this contact as a buyer')),
    })
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full max-w-lg" />
      </div>
    )
  }

  if (isError || !contact) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={goBack}>
          <ArrowLeft className="size-4" />
          Back
        </Button>
        <p className="text-sm text-muted-foreground">This contact could not be found.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <TaskFocusBanner />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={goBack}
          >
            <ArrowLeft className="size-4" />
            <span className="sr-only">Back</span>
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold">{contactName(contact)}</h1>
            {buyerClientId && <BuyerBadge />}
            {verifiedIds?.has(contact.id) && <VerifiedBadge />}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {buyerClientId ? (
            // Already a buyer — offering to mark them again would only produce a toast
            // saying so, when what you actually want is their criteria.
            <Button variant="outline" asChild>
              <Link to={`/tenant-rep/${buyerClientId}`}>
                <ShoppingBag className="size-4" />
                Open buyer
              </Link>
            </Button>
          ) : pendingIntake ? (
            <Button variant="outline" asChild>
              <Link to="/pipelines/buyers">
                <UserPlus className="size-4" />
                Waiting on buying criteria
              </Link>
            </Button>
          ) : (
            <Button variant="outline" onClick={handleMarkAsBuyer} disabled={markAsBuyer.isPending}>
              <UserPlus className="size-4" />
              Mark as buyer
            </Button>
          )}
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            <Pencil className="size-4" />
            Edit
          </Button>
        </div>
      </div>

      {pendingIntake && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-900/60 dark:bg-amber-950/30">
          <UserPlus className="size-4 shrink-0 text-amber-700 dark:text-amber-500" />
          <span>Marked as a buyer — they're on the buyers page until you fill in what they buy.</span>
          <Link
            to="/pipelines/buyers"
            className="font-medium underline underline-offset-2"
          >
            Fill it in
          </Link>
        </div>
      )}

      <dl className="grid max-w-lg grid-cols-1 gap-4 rounded-lg border bg-card p-4 sm:grid-cols-2">
        <Field label="Title" value={contact.title} />
        {contact.email && (
          <div>
            <dt className="text-xs font-medium text-muted-foreground">Email</dt>
            {/* The badge sits on the ADDRESS, not the person: a reply proves the mail
                arrives and nothing more, so the phone below stays unmarked. */}
            <dd className="mt-0.5 flex items-center gap-1.5 text-sm">
              {contact.email}
              {contact.email_verified_at && <EmailVerifiedBadge label={false} />}
            </dd>
          </div>
        )}
        <Field label="Phone" value={contact.phone} />
        {contact.company && (
          <div>
            <dt className="text-xs font-medium text-muted-foreground">Company</dt>
            <dd className="mt-0.5 text-sm">
              <Link to={`/companies/${contact.company.id}`} className="hover:underline">
                {contact.company.name}
              </Link>
            </dd>
          </div>
        )}
        <div className="sm:col-span-2">
          <Field label="Notes" value={contact.notes} />
        </div>
      </dl>

      <ContactTasks contactId={contact.id} />

      <section className="max-w-2xl space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Conversations</h2>
        <AddNoteBox contactId={contact.id} />
        <ConversationLog comms={comms ?? []} />
      </section>

      <ContactAssociations contactId={contact.id} />

      <ContactFormDialog open={editOpen} onOpenChange={setEditOpen} contact={contact} />
    </div>
  )
}
