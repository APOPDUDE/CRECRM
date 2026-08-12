import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { addDays, addMonths, format, nextMonday } from 'date-fns'
import { CalendarClock, Check, Mail, MessageSquare, Phone, StickyNote, Users } from 'lucide-react'
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
import { useCompleteTask, useRescheduleTask } from '@/hooks/use-tasks'
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

type Preset = { label: string; date: () => string }

/**
 * The two pickers deliberately offer different horizons.
 *
 * A follow-up after a call you just made is near-term — you said you'd send something
 * this week. A reschedule is usually the opposite: the owner told you to try again in a
 * quarter, and offering "in 3 days" for that just means pushing it four more times.
 */
const FOLLOW_UP_PRESETS: Preset[] = [
  { label: 'Tomorrow', date: () => iso(addDays(new Date(), 1)) },
  { label: 'In 3 days', date: () => iso(addDays(new Date(), 3)) },
  { label: 'Next week', date: () => iso(nextMonday(new Date())) },
  { label: 'In 2 weeks', date: () => iso(addDays(new Date(), 14)) },
]

const RESCHEDULE_PRESETS: Preset[] = [
  { label: 'Tomorrow', date: () => iso(addDays(new Date(), 1)) },
  { label: 'In 2 weeks', date: () => iso(addDays(new Date(), 14)) },
  { label: 'In 3 months', date: () => iso(addMonths(new Date(), 3)) },
  { label: 'In 6 months', date: () => iso(addMonths(new Date(), 6)) },
]

type Mode = 'done' | 'reschedule'

interface TaskCompleteDialogProps {
  task: Tables<'tasks'> | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Runs after the task is closed or moved — e.g. clear the `?task=` param. */
  onCompleted?: () => void
}

function DatePicker({
  value,
  onChange,
  presets,
}: {
  value: string
  onChange: (v: string) => void
  presets: Preset[]
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {presets.map((p) => {
        const date = p.date()
        return (
          <button
            key={p.label}
            type="button"
            onClick={() => onChange(date)}
            className={cn(
              'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
              value === date
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
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-auto py-0 text-xs"
      />
    </div>
  )
}

/**
 * The one thing that happens when you tick a task off.
 *
 * Ticking the box used to just close the task, with a separate Log button beside it for
 * the outcome — two controls for one decision, and the fast one silently threw away the
 * only record of what happened. Now the tick asks, because the honest answers to "did
 * you do this?" are three, not two: done, done and here's the next step, or I haven't
 * and it needs to move. A pushed task keeps its reason, filed in the same history as a
 * completed one.
 */
export function TaskCompleteDialog({ task, open, onOpenChange, onCompleted }: TaskCompleteDialogProps) {
  const complete = useCompleteTask()
  const reschedule = useRescheduleTask()
  const pending = complete.isPending || reschedule.isPending

  const [mode, setMode] = useState<Mode>('done')
  const [note, setNote] = useState('')
  const [kind, setKind] = useState<Enums<'note_kind'>>('note')
  const [withFollowUp, setWithFollowUp] = useState(false)
  const [followUpTitle, setFollowUpTitle] = useState('')
  const [followUpDate, setFollowUpDate] = useState('')
  const [newDueDate, setNewDueDate] = useState('')

  useEffect(() => {
    if (!open || !task) return
    setMode('done')
    setNote('')
    setKind(task.kind === 'tour' ? 'meeting' : 'note')
    setWithFollowUp(false)
    setFollowUpTitle(task.title)
    setFollowUpDate(FOLLOW_UP_PRESETS[2].date())
    // Defaults to two weeks rather than the longest option: a reschedule that lands six
    // months out by accident is a task you have effectively deleted.
    setNewDueDate(RESCHEDULE_PRESETS[1].date())
  }, [open, task])

  if (!task) return null

  const finish = (message: string) => {
    toast.success(message)
    onOpenChange(false)
    onCompleted?.()
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()

    if (mode === 'reschedule') {
      reschedule.mutate(
        { task, note, kind, dueDate: newDueDate },
        {
          onSuccess: () => finish(`Moved to ${formatDate(newDueDate) ?? newDueDate}`),
          onError: () => toast.error('Could not reschedule'),
        },
      )
      return
    }

    complete.mutate(
      {
        task,
        note,
        kind,
        followUp:
          withFollowUp && followUpTitle.trim() ? { title: followUpTitle, dueDate: followUpDate } : null,
      },
      {
        onSuccess: () =>
          finish(
            withFollowUp && followUpTitle.trim()
              ? `Done — next up ${formatDate(followUpDate) ?? 'with no date'}`
              : 'Task completed',
          ),
        onError: () => toast.error('Could not complete task'),
      },
    )
  }

  const modes: { value: Mode; label: string; icon: LucideIcon }[] = [
    { value: 'done', label: 'I did it', icon: Check },
    { value: 'reschedule', label: 'Reschedule', icon: CalendarClock },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{task.title}</DialogTitle>
          <DialogDescription>
            {task.due_date ? `Due ${formatDate(task.due_date)}` : 'No date set'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-muted p-1">
            {modes.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                className={cn(
                  'flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  mode === value
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="size-4" />
                {label}
              </button>
            ))}
          </div>

          {mode === 'reschedule' ? (
            <>
              <div className="space-y-2">
                <Label>Move it to</Label>
                <DatePicker value={newDueDate} onChange={setNewDueDate} presets={RESCHEDULE_PRESETS} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reschedule-note">Why? (optional)</Label>
                <Textarea
                  id="reschedule-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  autoFocus
                  placeholder="Asked me to call back next month…"
                />
              </div>
            </>
          ) : (
            <>
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
                  <Checkbox
                    checked={withFollowUp}
                    onCheckedChange={(v) => setWithFollowUp(v === true)}
                  />
                  Create a follow-up task
                </label>
                {withFollowUp && (
                  <div className="space-y-2.5">
                    <Input
                      value={followUpTitle}
                      onChange={(e) => setFollowUpTitle(e.target.value)}
                      placeholder="What's the next step?"
                    />
                    <DatePicker value={followUpDate} onChange={setFollowUpDate} presets={FOLLOW_UP_PRESETS} />
                  </div>
                )}
              </div>
            </>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {mode === 'reschedule' ? (
                <CalendarClock className="size-4" />
              ) : (
                <Check className="size-4" />
              )}
              {pending
                ? 'Saving…'
                : mode === 'reschedule'
                  ? 'Reschedule'
                  : withFollowUp
                    ? 'Complete + schedule'
                    : 'Complete task'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
