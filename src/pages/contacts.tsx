import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowUpDown, MoreHorizontal, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ContactFormDialog } from '@/components/contact-form-dialog'
import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog'
import { ListErrorState } from '@/components/list-error-state'
import { useContacts, useDeleteContact } from '@/hooks/use-contacts'
import { useVerifiedContactIds } from '@/hooks/use-owners'
import { VerifiedBadge } from '@/components/verified-badge'
import type { Contact } from '@/hooks/use-contacts'
import { usePersistentState } from '@/hooks/use-persistent-state'
import { friendlyDbError } from '@/lib/db-errors'

export function contactName(contact: Pick<Contact, 'first_name' | 'last_name'>) {
  return [contact.first_name, contact.last_name].filter(Boolean).join(' ')
}

type ContactSort = 'created' | 'activity' | 'alpha'

const SORT_LABELS: Record<ContactSort, string> = {
  created: 'Recently added',
  activity: 'Recent activity',
  alpha: 'Alphabetical',
}

export function ContactsPage() {
  const navigate = useNavigate()
  const { data: contacts, isLoading, isError, refetch } = useContacts()
  const { data: verifiedIds } = useVerifiedContactIds()
  const deleteContact = useDeleteContact()

  const [search, setSearch] = useState('')
  // Sticky so the list comes back the way you left it after visiting a contact.
  const [sort, setSort] = usePersistentState<ContactSort>('contacts:sort', 'created')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Contact | null>(null)
  const [deleting, setDeleting] = useState<Contact | null>(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const matched = !q
      ? (contacts ?? [])
      : (contacts ?? []).filter((c) =>
          [c.first_name, c.last_name, c.title, c.email, c.phone, c.company?.name]
            .filter(Boolean)
            .some((field) => field!.toLowerCase().includes(q)),
        )
    // The shared useContacts() query stays alphabetical because the contact pickers
    // depend on that ordering — this page sorts its own copy.
    const byDate = (field: 'created_at' | 'updated_at') => (a: Contact, b: Contact) =>
      Date.parse(b[field] ?? '') - Date.parse(a[field] ?? '')
    const sorters: Record<ContactSort, (a: Contact, b: Contact) => number> = {
      created: byDate('created_at'),
      activity: byDate('updated_at'),
      alpha: (a, b) => contactName(a).localeCompare(contactName(b), undefined, { sensitivity: 'base' }),
    }
    return [...matched].sort(sorters[sort] ?? sorters.created)
  }, [contacts, search, sort])

  const openCreate = () => {
    setEditing(null)
    setFormOpen(true)
  }

  const openEdit = (contact: Contact) => {
    setEditing(contact)
    setFormOpen(true)
  }

  const confirmDelete = () => {
    if (!deleting) return
    deleteContact.mutate(deleting.id, {
      onSuccess: () => {
        toast.success('Contact deleted')
        setDeleting(null)
      },
      onError: (error) => {
        toast.error(friendlyDbError(error, 'Could not delete contact'))
        setDeleting(null)
      },
    })
  }

  const rowMenu = (contact: Contact) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="size-4" />
          <span className="sr-only">Actions for {contactName(contact)}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onSelect={() => openEdit(contact)}>
          <Pencil className="size-4" />
          Edit
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(contact)}>
          <Trash2 className="size-4" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Contacts</h1>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search contacts…"
              className="pl-9"
            />
          </div>
          <Select value={sort} onValueChange={(v) => setSort(v as ContactSort)}>
            <SelectTrigger className="w-[9.5rem] shrink-0" aria-label="Sort contacts">
              <ArrowUpDown className="size-4 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SORT_LABELS) as ContactSort[]).map((key) => (
                <SelectItem key={key} value={key}>
                  {SORT_LABELS[key]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={openCreate}>
            <Plus className="size-4" />
            <span className="hidden sm:inline">Add contact</span>
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
        <ListErrorState message="Could not load contacts." onRetry={() => refetch()} />
      ) : (contacts ?? []).length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">
            No contacts yet — add the people you work with across deals.
          </p>
          <Button onClick={openCreate}>
            <Plus className="size-4" />
            Add contact
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">No contacts match “{search.trim()}”</p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden rounded-lg border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((contact) => (
                  <TableRow
                    key={contact.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/contacts/${contact.id}`)}
                  >
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-1.5">
                        {contactName(contact)}
                        {verifiedIds?.has(contact.id) && <VerifiedBadge label={false} />}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{contact.company?.name}</TableCell>
                    <TableCell className="text-muted-foreground">{contact.title}</TableCell>
                    <TableCell className="text-muted-foreground">{contact.email}</TableCell>
                    <TableCell className="text-muted-foreground">{contact.phone}</TableCell>
                    <TableCell>{rowMenu(contact)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-2 md:hidden">
            {filtered.map((contact) => (
              <div
                key={contact.id}
                className="flex items-center justify-between gap-2 rounded-lg border bg-card"
              >
                <Link to={`/contacts/${contact.id}`} className="flex min-w-0 flex-1 flex-col p-3">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <span className="truncate">{contactName(contact)}</span>
                    {verifiedIds?.has(contact.id) && <VerifiedBadge label={false} />}
                  </span>
                  {[contact.company?.name, contact.title].filter(Boolean).length > 0 && (
                    <span className="truncate text-xs text-muted-foreground">
                      {[contact.company?.name, contact.title].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </Link>
                <div className="flex shrink-0 items-center gap-1 pr-3">{rowMenu(contact)}</div>
              </div>
            ))}
          </div>
        </>
      )}

      <ContactFormDialog open={formOpen} onOpenChange={setFormOpen} contact={editing} />
      <ConfirmDeleteDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete contact?"
        description={`“${deleting ? contactName(deleting) : ''}” will be permanently deleted.`}
        pending={deleteContact.isPending}
        onConfirm={confirmDelete}
      />
    </div>
  )
}
