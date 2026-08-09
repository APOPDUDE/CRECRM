import { useState } from 'react'
import { Loader2, Send } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const PUSH_URL = 'https://n8n.ayxco.com/webhook/war-room-push'

export type PushContact = {
  phone: string
  first: string | null
  last: string | null
  email: string | null
  ownerName: string | null
  address: string | null
  city: string | null
  parcel: string | null
  propertyId: string
}

export type PushResult = { created: number; tagged: number; total: number; tag: string }

/**
 * Names the list, then hands the verified owners to GoHighLevel.
 *
 * GHL has no public smart-list API — a Smart List there is a saved filter, and what it
 * filters on is a tag. So the push creates/applies one tag per list; building the Smart
 * List from that tag is a single step in GHL and it stays live as more contacts get tagged.
 */
export function PushToGhlDialog({
  open,
  onOpenChange,
  contacts,
  skippedCount,
  onDownloadSkipped,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  contacts: PushContact[]
  /** properties in the current view whose owner has no reachable phone */
  skippedCount: number
  onDownloadSkipped: () => void
}) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const push = async () => {
    const listName = name.trim()
    if (!listName) return
    setBusy(true)
    try {
      const res = await fetch(PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listName, contacts }),
      })
      if (!res.ok) throw new Error(`push failed (${res.status})`)
      const r = (await res.json()) as PushResult
      toast.success(`Pushed ${r.total} to GoHighLevel`, {
        description: `${r.created} created, ${r.tagged} already there. Tag: ${r.tag}`,
      })
      onOpenChange(false)
      setName('')
      // The skipped rows are the whole point of a skip-trace pass, so offer them
      // immediately rather than making the user re-run the export separately.
      if (skippedCount > 0) onDownloadSkipped()
    } catch (e) {
      toast.error('Could not push to GoHighLevel', {
        description: e instanceof Error ? e.message : 'unknown error',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Push to GoHighLevel</DialogTitle>
          <DialogDescription>
            {contacts.length.toLocaleString()} verified owner{contacts.length === 1 ? '' : 's'} will
            be tagged into a list. Contacts already in GoHighLevel are added to the list, not
            duplicated.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="list-name">List name</Label>
          <Input
            id="list-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim() && !busy) void push()
            }}
            placeholder="Plant City industrial 20k+"
            autoFocus
          />
          <p className="text-xs text-muted-foreground">
            Becomes a tag in GoHighLevel. Build a Smart List filtered on it and the list stays
            live as more owners are tagged.
          </p>
        </div>

        {skippedCount > 0 && (
          <p className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
            {skippedCount.toLocaleString()} propert{skippedCount === 1 ? 'y has' : 'ies have'} no
            reachable owner phone and cannot be pushed. They download as a CSV for skip-tracing
            when this finishes.
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void push()} disabled={busy || !name.trim() || contacts.length === 0}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            {busy ? 'Pushing…' : `Push ${contacts.length.toLocaleString()}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
