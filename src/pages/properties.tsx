import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { MoreHorizontal, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { PropertyFormDialog, propertyKindLabels } from '@/components/property-form-dialog'
import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog'
import { useDeleteProperty, useProperties } from '@/hooks/use-properties'
import type { Property } from '@/hooks/use-properties'
import { friendlyDbError } from '@/lib/db-errors'

export function PropertyTypeBadge({ type }: { type: Property['property_type'] }) {
  if (!type) return null
  return (
    <Badge variant="outline" className="bg-gray-50 text-gray-600 border-gray-200">
      {propertyKindLabels[type]}
    </Badge>
  )
}

function formatLocation(property: Property) {
  return [property.city, property.state].filter(Boolean).join(', ')
}

export function PropertiesPage() {
  const navigate = useNavigate()
  const { data: properties, isLoading } = useProperties()
  const deleteProperty = useDeleteProperty()

  const [search, setSearch] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Property | null>(null)
  const [deleting, setDeleting] = useState<Property | null>(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return properties ?? []
    return (properties ?? []).filter((p) =>
      [
        p.address,
        p.city,
        p.state,
        p.zip,
        p.specs,
        p.property_type ? propertyKindLabels[p.property_type] : null,
      ]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(q)),
    )
  }, [properties, search])

  const openCreate = () => {
    setEditing(null)
    setFormOpen(true)
  }

  const openEdit = (property: Property) => {
    setEditing(property)
    setFormOpen(true)
  }

  const confirmDelete = () => {
    if (!deleting) return
    deleteProperty.mutate(deleting.id, {
      onSuccess: () => {
        toast.success('Property deleted')
        setDeleting(null)
      },
      onError: (error) => {
        toast.error(friendlyDbError(error, 'Could not delete property'))
        setDeleting(null)
      },
    })
  }

  const rowMenu = (property: Property) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="size-4" />
          <span className="sr-only">Actions for {property.address}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onSelect={() => openEdit(property)}>
          <Pencil className="size-4" />
          Edit
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(property)}>
          <Trash2 className="size-4" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Properties</h1>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search properties…"
              className="pl-9"
            />
          </div>
          <Button onClick={openCreate}>
            <Plus className="size-4" />
            <span className="hidden sm:inline">Add property</span>
            <span className="sm:hidden">Add</span>
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : (properties ?? []).length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">
            No properties yet — add the buildings and land you're working.
          </p>
          <Button onClick={openCreate}>
            <Plus className="size-4" />
            Add property
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">No properties match “{search.trim()}”</p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden rounded-lg border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Address</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Building SF</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((property) => (
                  <TableRow
                    key={property.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/properties/${property.id}`)}
                  >
                    <TableCell className="font-medium">{property.address}</TableCell>
                    <TableCell>
                      <PropertyTypeBadge type={property.property_type} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatLocation(property)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {property.building_sf != null
                        ? `${property.building_sf.toLocaleString()} SF`
                        : ''}
                    </TableCell>
                    <TableCell>{rowMenu(property)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-2 md:hidden">
            {filtered.map((property) => (
              <Link
                key={property.id}
                to={`/properties/${property.id}`}
                className="flex items-center justify-between gap-2 rounded-lg border bg-card p-3"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{property.address}</div>
                  {formatLocation(property) && (
                    <div className="truncate text-xs text-muted-foreground">
                      {formatLocation(property)}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <PropertyTypeBadge type={property.property_type} />
                  {rowMenu(property)}
                </div>
              </Link>
            ))}
          </div>
        </>
      )}

      <PropertyFormDialog open={formOpen} onOpenChange={setFormOpen} property={editing} />
      <ConfirmDeleteDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete property?"
        description={`“${deleting?.address}” will be permanently deleted. If it's linked to a listing or match, deletion will be blocked.`}
        pending={deleteProperty.isPending}
        onConfirm={confirmDelete}
      />
    </div>
  )
}
