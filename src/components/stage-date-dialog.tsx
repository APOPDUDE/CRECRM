import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { format } from 'date-fns'
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
import type { TablesUpdate } from '@/lib/database.types'

/** Match stages that prompt for a date (and, for tours, a time) when reached. */
export type DatedStage = 'toured' | 'loi' | 'lease_negotiation'

const CONFIG: Record<
  DatedStage,
  { title: string; description: string; dateLabel: string; withTime?: boolean }
> = {
  toured: {
    title: 'Tour date',
    description: 'When is (or was) the tour? Add a time to pin it to a slot.',
    dateLabel: 'Date',
    withTime: true,
  },
  loi: {
    title: 'LOI sent',
    description: 'When was the LOI sent?',
    dateLabel: 'Date sent',
  },
  lease_negotiation: {
    title: 'Lease negotiation',
    description: 'When did lease negotiation begin?',
    dateLabel: 'Start date',
  },
}

interface StageDateDialogProps {
  stage: DatedStage | null
  open: boolean
  onOpenChange: (open: boolean) => void
  pending?: boolean
  onConfirm: (patch: Partial<TablesUpdate<'matches'>>) => void
}

/** Captures the date a match entered a stage, writing it to the matching column. */
export function StageDateDialog({
  stage,
  open,
  onOpenChange,
  pending,
  onConfirm,
}: StageDateDialogProps) {
  const cfg = stage ? CONFIG[stage] : null
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')

  useEffect(() => {
    if (open) {
      setDate(format(new Date(), 'yyyy-MM-dd'))
      setTime('')
    }
  }, [open, stage])

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!stage || !date) return
    if (stage === 'toured') {
      const tourAt = time ? new Date(`${date}T${time}`).toISOString() : null
      onConfirm({ tour_date: date, tour_at: tourAt })
    } else if (stage === 'loi') {
      onConfirm({ loi_date: date })
    } else {
      onConfirm({ lease_negotiation_date: date })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{cfg?.title}</DialogTitle>
          <DialogDescription>{cfg?.description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className={cfg?.withTime ? 'grid grid-cols-2 gap-3' : ''}>
            <div className="space-y-2">
              <Label htmlFor="stage-date">{cfg?.dateLabel}</Label>
              <Input
                id="stage-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                autoFocus
              />
            </div>
            {cfg?.withTime && (
              <div className="space-y-2">
                <Label htmlFor="stage-time">Time (optional)</Label>
                <Input
                  id="stage-time"
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                />
              </div>
            )}
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDate(format(new Date(), 'yyyy-MM-dd'))}
            >
              Today
            </Button>
            <Button type="submit" disabled={pending || !date}>
              {pending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
