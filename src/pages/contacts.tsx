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
import { Badge } from '@/components/ui/badge'
import { ContactFormDialog } from '@/components/contact-form-dialog'
import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog'
import { ListErrorState } from '@/components/list-error-state'
import { GhlPhoneLink } from '@/components/ghl-phone-link'
import {
  CONTACT_SEARCH_MIN,
  useContactBook,
  useContactSearch,
  useDeleteContact,
} from '@/hooks/use-contacts'
import { useVerifiedContactIds } from '@/hooks/use-owners'
import { useBuyerContactIds } from '@/hooks/use-buyers'
import { BuyerBadge } from '@/components/buyer-badge'
import { VerifiedBadge } from '@/components/verified-badge'
import type { Contact, ContactSort } from '@/hooks/use-contacts'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { usePersistentState } from '@/hooks/use-persistent-state'
import { friendlyDbError } from '@/lib/db-errors'

export function contactName(contact: Pick<Contact, 'first_name' | 'last_name'>) {
  return [contact.first_name, contact.last_name].filter(Boolean).join(' ')
}

const SORT_LABELS: Record<ContactSort, string> = {
  created: 'Recently added',
  activity: 'Recent activity',
  alpha: 'Alphabetical',
}

/** How many of the book to show when you're browsing rather than looking for someone. */
const BROWSE_LIMIT = 100

/**
 * Archived contacts are hidden from the browse list but still findable by search, so a hit
 * has to say why it isn't in the list you were just looking at.
 */
function ArchivedBadge() {
  return (
    <Badge variant="outline" className="font-normal text-muted-foreground" title="Hidden from the contact list — no deal, note or campaign points at them">
      Archived
    </Badge>
  )
}

export function ContactsPage() {
  const navigate = useNavigate()
  const { data: verifiedIds } = useVerifiedContactIds()
  const { data: buyerIds } = useBuyerContactIds()
  const deleteContact = useDeleteContact()

  const [search, setSearch] = useState('')
  // Sticky so the list comes back the way you left it after visiting a contact.
  const [sort, setSort] = usePersistentState<ContactSort>('contacts:sort', 'created')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Contact | null>(null)
  const [deleting, setDeleting] = useState<Contact | null>(null)

  const query = useDebouncedValue(search.trim(), 250)
  const searching = query.length >= CONTACT_SEARCH_MIN
  const book = useContactBook(sort, BROWSE_LIMIT)
  // Searching hits Postgres over the whole book, archived rows included — the one thing
  // archiving must never do is hide someone you know exists and are looking for.
  const results = useContactSearch(query, { limit: 100 })

  const { isLoading, isError, refetch } = searching
    ? { isLoading: results.isLoading, isError: results.isError, refetch: results.refetch }
    : { isLoading: book.isLoading, isError: book.isError, refetch: book.refetch }

  const filtered = useMemo(
    () => (searching ? (results.data ?? []) : (book.data?.rows ?? [])),
    [searching, results.data, book.data],
  )
  const total = book.data?.total ?? 0
  const archivedHits = filtered.filter((c) => c.archived).length

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

  // What you need to know about someone before opening them: are they a buyer, have we
  // actually confirmed them, and are they in the live book at all.
  const badgesFor = (contact: Contact) => (
    <>
      {buyerIds?.buyers.has(contact.id) ? (
        <BuyerBadge />
      ) : buyerIds?.pending.has(contact.id) ? (
        <BuyerBadge pending />
      ) : null}
      {verifiedIds?.has(contact.id) && <VerifiedBadge />}
      {contact.archived && <ArchivedBadge />}
    </>
  )

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
              placeholder="Name, phone, email, company…"
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

      {/* The book is far bigger than one screen, so say what you're looking at: browsing shows
          the top of it, searching covers all of it. */}
      <p className="text-xs text-muted-foreground">
        {isLoading || isError ? (
          // Never print "0 matches" over a search that hasn't answered yet or failed —
          // that is the exact sentence this whole page was fixed for not being true.
          <>{isLoading ? 'Searching…' : ' '}</>
        ) : searching ? (
          <>
            {filtered.length} match{filtered.length === 1 ? '' : 'es'} across all {total || ''}{' '}
            contacts
            {archivedHits > 0 && ` · ${archivedHits} archived`}
          </>
        ) : total > BROWSE_LIMIT ? (
          <>
            Showing {filtered.length} of {total} contacts — search to reach the rest
          </>
        ) : (
          <>
            {total} contact{total === 1 ? '' : 's'}
          </>
        )}
      </p>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : isError ? (
        <ListErrorState message="Could not load contacts." onRetry={() => refetch()} />
      ) : !searching && total === 0 ? (
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
          <p className="text-sm text-muted-foreground">
            {searching
              ? `Nobody in the book matches “${query}” — not by name, phone, email or company.`
              : 'No contacts to show.'}
          </p>
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
                      <span className="flex flex-wrap items-center gap-1.5">
                        {contactName(contact)}
                        {badgesFor(contact)}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{contact.company?.name}</TableCell>
                    <TableCell className="text-muted-foreground">{contact.title}</TableCell>
                    <TableCell className="text-muted-foreground">{contact.email}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {contact.phone && (
                        <GhlPhoneLink phone={contact.phone} ghlContactId={contact.ghl_contact_id} />
                      )}
                    </TableCell>
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
                  <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                    <span className="truncate">{contactName(contact)}</span>
                    {badgesFor(contact)}
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
