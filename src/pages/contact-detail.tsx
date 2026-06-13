import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ContactFormDialog } from '@/components/contact-form-dialog'
import { contactName } from '@/pages/contacts'
import { useContact } from '@/hooks/use-contacts'
import { useSetBreadcrumb } from '@/hooks/use-breadcrumb'

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

  useSetBreadcrumb(contact ? contactName(contact) : undefined)

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
        <Button variant="ghost" size="sm" onClick={() => navigate('/contacts')}>
          <ArrowLeft className="size-4" />
          Back to contacts
        </Button>
        <p className="text-sm text-muted-foreground">This contact could not be found.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => navigate('/contacts')}
          >
            <ArrowLeft className="size-4" />
            <span className="sr-only">Back to contacts</span>
          </Button>
          <div>
            <h1 className="text-xl font-semibold">{contactName(contact)}</h1>
          </div>
        </div>
        <Button variant="outline" onClick={() => setEditOpen(true)}>
          <Pencil className="size-4" />
          Edit
        </Button>
      </div>

      <dl className="grid max-w-lg grid-cols-1 gap-4 rounded-lg border bg-card p-4 sm:grid-cols-2">
        <Field label="Title" value={contact.title} />
        <Field label="Email" value={contact.email} />
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

      <p className="text-xs text-muted-foreground">
        Linked listings, tenant reps and matches appear here in a later phase.
      </p>

      <ContactFormDialog open={editOpen} onOpenChange={setEditOpen} contact={contact} />
    </div>
  )
}
