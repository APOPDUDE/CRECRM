import { useState } from 'react'
import type { FormEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useResetOn } from '@/hooks/use-reset-on'
import { useCreateNoteAndTask } from '@/hooks/use-tasks'
import type { ParentType } from '@/hooks/use-notes'

interface NoteTaskDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Which button opened it: the form leads with a note, or leads with a task. */
  mode: 'note' | 'task'
  parentType: ParentType
  parentId: string
}

/**
 * "Add note" / "Add task" for a record page header. Same two things either way — a note
 * and a task that points at it — the mode only decides which one is required and which
 * is the optional tick-to-add. Writes through `useCreateNoteAndTask`, so a note or task
 * raised here is identical to one raised from a board panel or the notes log.
 */
export function NoteTaskDialog({ open, onOpenChange, mode, parentType, parentId }: NoteTaskDialogProps) {
  const save = useCreateNoteAndTask()
  const [note, setNote] = useState('')
  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [withOther, setWithOther] = useState(false)

  useResetOn([open, mode], () => {
    if (open) {
      setNote('')
      setTitle('')
      setDueDate('')
      setWithOther(false)
    }
  })

  const primaryOk = mode === 'note' ? !!note.trim() : !!title.trim()
  const noteOn = mode === 'note' || withOther
  const taskOn = mode === 'task' || withOther

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!primaryOk) return
    try {
      const saved = await save.mutateAsync({
        parentType,
        parentId,
        note: noteOn ? note : null,
        task: taskOn ? { title, due_date: dueDate } : null,
      })
      toast.success(
        saved.note && saved.task ? 'Note + task added' : saved.task ? 'Task added' : 'Note added',
      )
      onOpenChange(false)
    } catch {
      toast.error(mode === 'note' ? 'Could not save note' : 'Could not add task')
    }
  }

  const noteField = (
    <div className="space-y-2">
      <Label htmlFor="nt-note">Note</Label>
      <Textarea
        id="nt-note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        autoFocus={mode === 'note'}
        placeholder={mode === 'note' ? 'What happened…' : 'Note saved with this task…'}
      />
    </div>
  )

  const taskFields = (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_10rem]">
      <div className="space-y-2">
        <Label htmlFor="nt-title">Task</Label>
        <Input
          id="nt-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus={mode === 'task'}
          placeholder="Call the owner back"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="nt-due">Date</Label>
        <Input id="nt-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
      </div>
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === 'note' ? 'Add note' : 'Add task'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'note' ? noteField : taskFields}
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={withOther} onCheckedChange={(v) => setWithOther(v === true)} />
            {mode === 'note' ? 'Add a task?' : 'Add a note?'}
          </label>
          {withOther && (mode === 'note' ? taskFields : noteField)}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending || !primaryOk}>
              {save.isPending ? 'Saving…' : mode === 'note' ? 'Save note' : 'Add task'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
