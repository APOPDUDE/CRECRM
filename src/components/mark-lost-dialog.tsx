import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

interface MarkLostDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** Number of open (non-dead) matches that could be marked dead alongside this. */
  openMatchCount: number
  pending?: boolean
  onConfirm: (lostReason: string | null, alsoMarkMatchesDead: boolean) => void
}

export function MarkLostDialog({
  open,
  onOpenChange,
  title,
  openMatchCount,
  pending,
  onConfirm,
}: MarkLostDialogProps) {
  const [reason, setReason] = useState('')
  const [markDead, setMarkDead] = useState(true)

  useEffect(() => {
    if (open) {
      setReason('')
      setMarkDead(true)
    }
  }, [open])

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    onConfirm(reason.trim() || null, openMatchCount > 0 && markDead)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            It will leave the board but stay visible in the table view under the Lost filter.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="lost-reason">Reason</Label>
            <Textarea
              id="lost-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why did this fall through?"
              rows={3}
              autoFocus
            />
          </div>
          {openMatchCount > 0 && (
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={markDead}
                onCheckedChange={(v) => setMarkDead(v === true)}
                className="mt-0.5"
              />
              <span>
                Also mark {openMatchCount} open{' '}
                {openMatchCount === 1 ? 'prospect' : 'prospects'} as dead
              </span>
            </label>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? 'Saving…' : 'Mark lost'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
