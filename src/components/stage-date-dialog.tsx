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

/** Pursuit stages that prompt for a date when reached. */
export type DatedStage = 'touring'

const CONFIG: Record<DatedStage, { title: string; description: string; dateLabel: string }> = {
  touring: {
    title: 'Tour date',
    description: 'When is (or was) the tour?',
    dateLabel: 'Date',
  },
}

interface StageDateDialogProps {
  stage: DatedStage | null
  open: boolean
  onOpenChange: (open: boolean) => void
  pending?: boolean
  onConfirm: (patch: Partial<TablesUpdate<'pursuits'>>) => void
}

/** Captures the date a pursuit entered a stage, writing it to the matching column. */
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
    onConfirm({ tour_date: date, tour_time: time || null })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{cfg?.title}</DialogTitle>
          <DialogDescription>{cfg?.description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
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
            <div className="space-y-2">
              <Label htmlFor="stage-time">Time</Label>
              <Input
                id="stage-time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </div>
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
