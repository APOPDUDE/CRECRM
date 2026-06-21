import { useEffect, useState } from 'react'
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
import {
  clientLabel,
  useApproveSuggestion,
  useSearchingClients,
  type Suggestion,
} from '@/hooks/use-suggestions'

interface ApproveSuggestionDialogProps {
  suggestion: Suggestion | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Choose which searching client a suggested property is added to. Defaults to the
 * client it was originally suggested for, but any searching client can be picked.
 */
export function ApproveSuggestionDialog({
  suggestion,
  open,
  onOpenChange,
}: ApproveSuggestionDialogProps) {
  const { data: clients = [] } = useSearchingClients()
  const approve = useApproveSuggestion()
  const [clientId, setClientId] = useState('')

  // Default the dropdown to whoever the property was suggested for.
  useEffect(() => {
    if (open) setClientId(suggestion?.tenant_rep?.id ?? '')
  }, [open, suggestion])

  if (!suggestion) return null

  const handleAdd = () => {
    if (!clientId) return
    approve.mutate(
      { id: suggestion.id, clientId },
      {
        onSuccess: () => {
          const picked = clients.find((c) => c.id === clientId)
          toast.success(`Added to ${picked ? clientLabel(picked) : 'the client'}`)
          onOpenChange(false)
        },
        onError: () => toast.error('Could not add it'),
      },
    )
  }

  const location = [suggestion.property?.city, suggestion.property?.state]
    .filter(Boolean)
    .join(', ')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add property to a client</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <div className="text-sm font-medium">
              {suggestion.property?.address ?? 'Property'}
            </div>
            {location && <div className="text-xs text-muted-foreground">{location}</div>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="suggestion-client">Add to client</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger id="suggestion-client" className="w-full">
                <SelectValue placeholder="Choose a client" />
              </SelectTrigger>
              <SelectContent>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {clientLabel(c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleAdd} disabled={!clientId || approve.isPending}>
            {approve.isPending ? 'Adding…' : 'Add'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
