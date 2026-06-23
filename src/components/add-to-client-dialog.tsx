import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { clientLabel, useSearchingClients } from '@/hooks/use-suggestions'
import { useCreateMatch } from '@/hooks/use-matches'
import { useAuth } from '@/hooks/use-auth'
import { friendlyDbError } from '@/lib/db-errors'

export type AddToClientProperty = {
  id: string
  address: string
  city: string | null
  state: string | null
}

interface AddToClientDialogProps {
  property: AddToClientProperty | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Pick a searching client to add a (new) listing to — creates an inquiring pursuit on
 * that client's board. Replaces the old auto-suggestion "approve" flow now that
 * matching is paused; the broker decides which client a listing belongs to.
 */
export function AddToClientDialog({ property, open, onOpenChange }: AddToClientDialogProps) {
  const { session } = useAuth()
  const { data: clients = [] } = useSearchingClients()
  const createMatch = useCreateMatch()
  const [clientId, setClientId] = useState('')

  useEffect(() => {
    if (open) setClientId('')
  }, [open])

  if (!property) return null

  const handleAdd = () => {
    if (!clientId || !session?.user.id) return
    createMatch.mutate(
      {
        property_id: property.id,
        client_id: clientId,
        owner_id: session.user.id,
        inquiry_date: format(new Date(), 'yyyy-MM-dd'),
      },
      {
        onSuccess: () => {
          const picked = clients.find((c) => c.id === clientId)
          toast.success(`Added to ${picked ? clientLabel(picked) : 'the client'}`)
          onOpenChange(false)
        },
        onError: (err) => toast.error(friendlyDbError(err, 'Could not add it')),
      },
    )
  }

  const location = [property.city, property.state].filter(Boolean).join(', ')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add listing to a client</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <div className="text-sm font-medium">{property.address}</div>
            {location && <div className="text-xs text-muted-foreground">{location}</div>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="add-client">Add to client</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger id="add-client" className="w-full">
                <SelectValue placeholder="Choose a client" />
              </SelectTrigger>
              <SelectContent>
                {clients.length === 0 ? (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">
                    No searching clients
                  </div>
                ) : (
                  clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {clientLabel(c)}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleAdd} disabled={!clientId || createMatch.isPending}>
            {createMatch.isPending ? 'Adding…' : 'Add'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
