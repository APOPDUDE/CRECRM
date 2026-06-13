import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { CompanyFormDialog } from '@/components/company-form-dialog'
import { CompanyTypeBadge } from '@/pages/companies'
import { useCompany } from '@/hooks/use-companies'
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

export function CompanyDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: company, isLoading, isError } = useCompany(id)
  const [editOpen, setEditOpen] = useState(false)

  useSetBreadcrumb(company?.name)

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full max-w-lg" />
      </div>
    )
  }

  if (isError || !company) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/companies')}>
          <ArrowLeft className="size-4" />
          Back to companies
        </Button>
        <p className="text-sm text-muted-foreground">This company could not be found.</p>
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
            onClick={() => navigate('/companies')}
          >
            <ArrowLeft className="size-4" />
            <span className="sr-only">Back to companies</span>
          </Button>
          <div>
            <h1 className="text-xl font-semibold">{company.name}</h1>
            <div className="mt-1">
              <CompanyTypeBadge type={company.type} />
            </div>
          </div>
        </div>
        <Button variant="outline" onClick={() => setEditOpen(true)}>
          <Pencil className="size-4" />
          Edit
        </Button>
      </div>

      <dl className="grid max-w-lg grid-cols-1 gap-4 rounded-lg border bg-card p-4 sm:grid-cols-2">
        <Field label="Phone" value={company.phone} />
        <Field label="Website" value={company.website} />
        <div className="sm:col-span-2">
          <Field label="Notes" value={company.notes} />
        </div>
      </dl>

      <p className="text-xs text-muted-foreground">
        Linked contacts, listings and tenant reps appear here in a later phase.
      </p>

      <CompanyFormDialog open={editOpen} onOpenChange={setEditOpen} company={company} />
    </div>
  )
}
