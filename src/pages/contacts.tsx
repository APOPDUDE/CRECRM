import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { MoreHorizontal, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
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
import { ContactFormDialog } from '@/components/contact-form-dialog'
import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog'
import { useContacts, useDeleteContact } from '@/hooks/use-contacts'
import type { Contact } from '@/hooks/use-contacts'
import { friendlyDbError } from '@/lib/db-errors'

export function contactName(contact: Pick<Contact, 'first_name' | 'last_name'>) {
  return [contact.first_name, contact.last_name].filter(Boolean).join(' ')
}

export function ContactsPage() {
  const navigate = useNavigate()
  const { data: contacts, isLoading } = useContacts()
  const deleteContact = useDeleteContact()

  const [search, setSearch] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Contact | null>(null)
  const [deleting, setDeleting] = useState<Contact | null>(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return contacts ?? []
    return (contacts ?? []).filter((c) =>
      [c.first_name, c.last_name, c.title, c.email, c.phone, c.company?.name]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(q)),
    )
  }, [contacts, search])

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
                    <TableCell className="font-medium">{contactName(contact)}</TableCell>
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
              <Link
                key={contact.id}
                to={`/contacts/${contact.id}`}
                className="flex items-center justify-between gap-2 rounded-lg border bg-card p-3"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{contactName(contact)}</div>
                  {[contact.company?.name, contact.title].filter(Boolean).length > 0 && (
                    <div className="truncate text-xs text-muted-foreground">
                      {[contact.company?.name, contact.title].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">{rowMenu(contact)}</div>
              </Link>
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
