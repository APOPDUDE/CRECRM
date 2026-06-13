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

interface TourDateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  pending?: boolean
  onConfirm: (tourDate: string) => void
}

export function TourDateDialog({ open, onOpenChange, pending, onConfirm }: TourDateDialogProps) {
  const [date, setDate] = useState('')

  useEffect(() => {
    if (open) setDate(format(new Date(), 'yyyy-MM-dd'))
  }, [open])

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (date) onConfirm(date)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Tour date</DialogTitle>
          <DialogDescription>When did (or will) this tour happen?</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tour-date">Date</Label>
            <Input
              id="tour-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending || !date}>
              {pending ? 'Saving…' : 'Save tour date'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
