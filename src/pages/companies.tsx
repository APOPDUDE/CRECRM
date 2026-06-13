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
import { CompanyFormDialog, companyTypeLabels } from '@/components/company-form-dialog'
import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog'
import { ListErrorState } from '@/components/list-error-state'
import { useCompanies, useDeleteCompany } from '@/hooks/use-companies'
import type { Company } from '@/hooks/use-companies'
import { friendlyDbError } from '@/lib/db-errors'

const typeBadgeClasses: Record<Company['type'], string> = {
  landlord: 'bg-blue-50 text-blue-700 border-blue-200',
  tenant: 'bg-green-50 text-green-700 border-green-200',
  broker: 'bg-purple-50 text-purple-700 border-purple-200',
  other: 'bg-gray-50 text-gray-600 border-gray-200',
}

export function CompanyTypeBadge({ type }: { type: Company['type'] }) {
  return (
    <Badge variant="outline" className={typeBadgeClasses[type]}>
      {companyTypeLabels[type]}
    </Badge>
  )
}

export function CompaniesPage() {
  const navigate = useNavigate()
  const { data: companies, isLoading, isError, refetch } = useCompanies()
  const deleteCompany = useDeleteCompany()

  const [search, setSearch] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Company | null>(null)
  const [deleting, setDeleting] = useState<Company | null>(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return companies ?? []
    return (companies ?? []).filter((c) =>
      [c.name, c.phone, c.website, companyTypeLabels[c.type]]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(q)),
    )
  }, [companies, search])

  const openCreate = () => {
    setEditing(null)
    setFormOpen(true)
  }

  const openEdit = (company: Company) => {
    setEditing(company)
    setFormOpen(true)
  }

  const confirmDelete = () => {
    if (!deleting) return
    deleteCompany.mutate(deleting.id, {
      onSuccess: () => {
        toast.success('Company deleted')
        setDeleting(null)
      },
      onError: (error) => {
        toast.error(friendlyDbError(error, 'Could not delete company'))
        setDeleting(null)
      },
    })
  }

  const rowMenu = (company: Company) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="size-4" />
          <span className="sr-only">Actions for {company.name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onSelect={() => openEdit(company)}>
          <Pencil className="size-4" />
          Edit
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(company)}>
          <Trash2 className="size-4" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Companies</h1>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search companies…"
              className="pl-9"
            />
          </div>
          <Button onClick={openCreate}>
            <Plus className="size-4" />
            <span className="hidden sm:inline">Add company</span>
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
      ) : isError ? (
        <ListErrorState message="Could not load companies." onRetry={() => refetch()} />
      ) : (companies ?? []).length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">
            No companies yet — add the landlords, tenants and brokers you work with.
          </p>
          <Button onClick={openCreate}>
            <Plus className="size-4" />
            Add company
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">No companies match “{search.trim()}”</p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden rounded-lg border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Website</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((company) => (
                  <TableRow
                    key={company.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/companies/${company.id}`)}
                  >
                    <TableCell className="font-medium">{company.name}</TableCell>
                    <TableCell>
                      <CompanyTypeBadge type={company.type} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{company.phone}</TableCell>
                    <TableCell className="text-muted-foreground">{company.website}</TableCell>
                    <TableCell>{rowMenu(company)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-2 md:hidden">
            {filtered.map((company) => (
              <div
                key={company.id}
                className="flex items-center justify-between gap-2 rounded-lg border bg-card"
              >
                <Link to={`/companies/${company.id}`} className="flex min-w-0 flex-1 flex-col p-3">
                  <span className="truncate text-sm font-medium">{company.name}</span>
                  {company.phone && (
                    <span className="truncate text-xs text-muted-foreground">{company.phone}</span>
                  )}
                </Link>
                <div className="flex shrink-0 items-center gap-1 pr-3">
                  <CompanyTypeBadge type={company.type} />
                  {rowMenu(company)}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <CompanyFormDialog open={formOpen} onOpenChange={setFormOpen} company={editing} />
      <ConfirmDeleteDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete company?"
        description={`“${deleting?.name}” will be permanently deleted. Contacts linked to it will keep their other details.`}
        pending={deleteCompany.isPending}
        onConfirm={confirmDelete}
      />
    </div>
  )
}
