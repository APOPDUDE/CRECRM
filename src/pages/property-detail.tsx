import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { PropertyFormDialog, propertyKindLabels } from '@/components/property-form-dialog'
import { PropertyTypeBadge } from '@/pages/properties'
import { useProperty } from '@/hooks/use-properties'
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

export function PropertyDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: property, isLoading, isError } = useProperty(id)
  const [editOpen, setEditOpen] = useState(false)

  useSetBreadcrumb(property?.address)

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full max-w-lg" />
      </div>
    )
  }

  if (isError || !property) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/properties')}>
          <ArrowLeft className="size-4" />
          Back to properties
        </Button>
        <p className="text-sm text-muted-foreground">This property could not be found.</p>
      </div>
    )
  }

  const location = [property.city, property.state, property.zip].filter(Boolean).join(', ')

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => navigate('/properties')}
          >
            <ArrowLeft className="size-4" />
            <span className="sr-only">Back to properties</span>
          </Button>
          <div>
            <h1 className="text-xl font-semibold">{property.address}</h1>
            {property.property_type && (
              <div className="mt-1">
                <PropertyTypeBadge type={property.property_type} />
              </div>
            )}
          </div>
        </div>
        <Button variant="outline" onClick={() => setEditOpen(true)}>
          <Pencil className="size-4" />
          Edit
        </Button>
      </div>

      <dl className="grid max-w-lg grid-cols-1 gap-4 rounded-lg border bg-card p-4 sm:grid-cols-2">
        <Field
          label="Type"
          value={property.property_type ? propertyKindLabels[property.property_type] : null}
        />
        <Field label="Location" value={location || null} />
        <Field
          label="Building SF"
          value={property.building_sf != null ? `${property.building_sf.toLocaleString()} SF` : null}
        />
        <Field
          label="Land acres"
          value={property.land_acres != null ? String(property.land_acres) : null}
        />
        <div className="sm:col-span-2">
          <Field label="Specs" value={property.specs} />
        </div>
      </dl>

      <p className="text-xs text-muted-foreground">
        Linked listings, tenant reps and matches appear here in a later phase.
      </p>

      <PropertyFormDialog open={editOpen} onOpenChange={setEditOpen} property={property} />
    </div>
  )
}
