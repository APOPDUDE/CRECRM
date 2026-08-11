import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { addDays, format, nextMonday } from 'date-fns'
import { Check, Mail, MessageSquare, Phone, StickyNote, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useCompleteTask } from '@/hooks/use-tasks'
import type { Enums, Tables } from '@/lib/database.types'
import { formatDate } from '@/lib/dates'
import { cn } from '@/lib/utils'

const OUTCOMES: { kind: Enums<'note_kind'>; label: string; icon: LucideIcon }[] = [
  { kind: 'call', label: 'Call', icon: Phone },
  { kind: 'email', label: 'Email', icon: Mail },
  { kind: 'text', label: 'Text', icon: MessageSquare },
  { kind: 'meeting', label: 'Meeting', icon: Users },
  { kind: 'note', label: 'Note', icon: StickyNote },
]

const iso = (d: Date) => format(d, 'yyyy-MM-dd')

/** Quick due dates for the follow-up, so the common case never needs the date picker. */
const DUE_PRESETS: { label: string; date: () => string }[] = [
  { label: 'Tomorrow', date: () => iso(addDays(new Date(), 1)) },
  { label: 'In 3 days', date: () => iso(addDays(new Date(), 3)) },
  { label: 'Next week', date: () => iso(nextMonday(new Date())) },
  { label: 'In 2 weeks', date: () => iso(addDays(new Date(), 14)) },
]

interface TaskCompleteDialogProps {
  task: Tables<'tasks'> | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Runs after a successful completion — e.g. clear the `?task=` param. */
  onCompleted?: () => void
}

/**
 * Close out a task the way you actually work one: say what happened, then either
 * be done with it or put the next step on the list. The outcome is filed against
 * whatever the task hangs on, so the note shows up in the history you'll read the
 * next time this contact or deal comes around.
 */
export function TaskCompleteDialog({ task, open, onOpenChange, onCompleted }: TaskCompleteDialogProps) {
  const complete = useCompleteTask()

  const [note, setNote] = useState('')
  const [kind, setKind] = useState<Enums<'note_kind'>>('note')
  const [withFollowUp, setWithFollowUp] = useState(false)
  const [followUpTitle, setFollowUpTitle] = useState('')
  const [followUpDate, setFollowUpDate] = useState('')

  useEffect(() => {
    if (!open || !task) return
    setNote('')
    setKind(task.kind === 'tour' ? 'meeting' : 'note')
    setWithFollowUp(false)
    setFollowUpTitle(task.title)
    setFollowUpDate(DUE_PRESETS[2].date())
  }, [open, task])

  if (!task) return null

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    complete.mutate(
      {
        task,
        note,
        kind,
        followUp: withFollowUp && followUpTitle.trim() ? { title: followUpTitle, dueDate: followUpDate } : null,
      },
      {
        onSuccess: () => {
          toast.success(
            withFollowUp && followUpTitle.trim()
              ? `Done — next up ${formatDate(followUpDate) ?? 'with no date'}`
              : 'Task completed',
          )
          onOpenChange(false)
          onCompleted?.()
        },
        onError: () => toast.error('Could not complete task'),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Complete task</DialogTitle>
          <DialogDescription className="truncate">{task.title}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>How did it go?</Label>
            <div className="flex flex-wrap gap-1.5">
              {OUTCOMES.map(({ kind: k, label, icon: Icon }) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
                    kind === k
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-accent',
                  )}
                >
                  <Icon className="size-3.5" />
                  {label}
                </button>
              ))}
            </div>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              autoFocus
              placeholder="What happened — what they said, where it left off…"
            />
          </div>

          <div className="space-y-3 rounded-lg border bg-muted/40 p-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
              <Checkbox checked={withFollowUp} onCheckedChange={(v) => setWithFollowUp(v === true)} />
              Create a follow-up task
            </label>
            {withFollowUp && (
              <div className="space-y-2.5">
                <Input
                  value={followUpTitle}
                  onChange={(e) => setFollowUpTitle(e.target.value)}
                  placeholder="What's the next step?"
                />
                <div className="flex flex-wrap items-center gap-1.5">
                  {DUE_PRESETS.map((p) => {
                    const value = p.date()
                    return (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => setFollowUpDate(value)}
                        className={cn(
                          'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                          followUpDate === value
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'text-muted-foreground hover:bg-accent',
                        )}
                      >
                        {p.label}
                      </button>
                    )
                  })}
                  <Input
                    type="date"
                    value={followUpDate}
                    onChange={(e) => setFollowUpDate(e.target.value)}
                    className="h-7 w-auto py-0 text-xs"
                  />
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={complete.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={complete.isPending}>
              <Check className="size-4" />
              {complete.isPending ? 'Saving…' : withFollowUp ? 'Complete + schedule' : 'Complete task'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
