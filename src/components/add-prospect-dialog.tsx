import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Building2, Plus, X } from 'lucide-react'
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
import { Textarea } from '@/components/ui/textarea'
import { ContactSelect } from '@/components/contact-select'
import { useAuth } from '@/hooks/use-auth'
import { useCreateProspect } from '@/hooks/use-prospects'
import { usePropertySearch, type ParcelSearchResult } from '@/hooks/use-listing-parcels'
import { friendlyDbError } from '@/lib/db-errors'

interface AddProspectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type PickedProperty = Pick<ParcelSearchResult, 'id' | 'address' | 'city' | 'state'>

/**
 * Capture a raw prospecting lead: a contact, optional properties, and a short
 * description. It lives on the Prospecting page until it's pushed into a pipeline.
 */
export function AddProspectDialog({ open, onOpenChange }: AddProspectDialogProps) {
  const { session } = useAuth()
  const userId = session?.user.id
  const createProspect = useCreateProspect()

  const [contactId, setContactId] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<PickedProperty[]>([])
  const { data: results = [], isFetching } = usePropertySearch(search, '')

  useEffect(() => {
    if (open) {
      setContactId(null)
      setDescription('')
      setSearch('')
      setPicked([])
    }
  }, [open])

  const addProperty = (p: ParcelSearchResult) => {
    setPicked((prev) => (prev.some((x) => x.id === p.id) ? prev : [...prev, p]))
    setSearch('')
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!contactId || !userId) return
    try {
      await createProspect.mutateAsync({
        owner_id: userId,
        contact_id: contactId,
        description: description.trim() || null,
        property_ids: picked.map((p) => p.id),
      })
      toast.success('Prospect added')
      onOpenChange(false)
    } catch (err) {
      toast.error(friendlyDbError(err, 'Could not add prospect'))
    }
  }

  const suggestions = results.filter((r) => !picked.some((p) => p.id === r.id)).slice(0, 6)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add prospect</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Contact</Label>
            <ContactSelect value={contactId} onChange={setContactId} placeholder="Pick or create the person" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="prospect-desc">Description</Label>
            <Textarea
              id="prospect-desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What's the angle — owner thinking of selling, tenant outgrowing their space…"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="prospect-prop">Properties</Label>
            {picked.length > 0 && (
              <ul className="space-y-1">
                {picked.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center gap-2 rounded-md border bg-muted/40 px-2 py-1.5 text-sm"
                  >
                    <Building2 className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">
                      {p.address}
                      {p.city ? `, ${p.city}` : ''}
                    </span>
                    <button
                      type="button"
                      aria-label="Remove property"
                      onClick={() => setPicked((prev) => prev.filter((x) => x.id !== p.id))}
                      className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <X className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <Input
              id="prospect-prop"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search properties by address…"
              autoComplete="off"
            />
            {suggestions.length > 0 && (
              <ul className="divide-y overflow-hidden rounded-lg border">
                {suggestions.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => addProperty(p)}
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
            {search.trim().length >= 2 && suggestions.length === 0 && !isFetching && (
              <p className="text-xs text-muted-foreground">
                No matching properties — add it from the Properties page first, or leave this
                empty and attach later.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!contactId || createProspect.isPending}>
              {createProspect.isPending ? 'Adding…' : 'Add prospect'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
