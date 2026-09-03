import { useState } from 'react'
import { useResetOn } from '@/hooks/use-reset-on'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

/** Which way the tour went. `passed` is the "not interested" side — it uses the Passed rail. */
export type TourOutcome = 'interested' | 'passed'

const CONFIG: Record<TourOutcome, { title: string; description: string; placeholder: string }> = {
  interested: {
    title: 'What did they like?',
    description: 'Saved to the property, so the next deal on this address inherits it.',
    placeholder: 'Clear height worked, dock count worked, wants a 5-year term…',
  },
  passed: {
    title: 'Why did they pass?',
    description: 'Saved to the property, so the next deal on this address inherits it.',
    placeholder: 'Too few docks, yard too tight, landlord would not split the space…',
  },
}

/**
 * Asked when a pursuit moves to Interested or to the Passed rail.
 *
 * The reason is optional on purpose — the point is to make it easy to say something, not
 * to hold the board hostage. Saying nothing still records the outcome against the
 * property, because "someone toured this and walked" is itself worth knowing next year.
 */
export function TourOutcomeDialog({
  outcome,
  propertyLabel,
  open,
  onOpenChange,
  pending,
  onConfirm,
}: {
  outcome: TourOutcome | null
  /** The address this note will land on, so it is obvious where it is being filed. */
  propertyLabel?: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  pending?: boolean
  onConfirm: (reason: string) => void
}) {
  const [reason, setReason] = useState('')

  // Reset between openings, or the last deal's reason bleeds into the next one.
  useResetOn([open], () => {
    if (open) setReason('')
  })

  if (!outcome) return null
  const cfg = CONFIG[outcome]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{cfg.title}</DialogTitle>
          <DialogDescription>
            {propertyLabel ? `${propertyLabel} — ` : ''}
            {cfg.description}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="tour-reason">Notes</Label>
          <Textarea
            id="tour-reason"
            autoFocus
            rows={4}
            value={reason}
            placeholder={cfg.placeholder}
            onChange={(e) => setReason(e.target.value)}
            // Enter submits (with modifier), so a one-line reason never needs the mouse.
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                onConfirm(reason.trim())
              }
            }}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(reason.trim())} disabled={pending}>
            {outcome === 'interested' ? 'Mark interested' : 'Move to Passed'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
