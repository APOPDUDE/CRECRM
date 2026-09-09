import { useState } from 'react'
import type { FormEvent } from 'react'
import { CheckSquare } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { useCreateNoteAndTask } from '@/hooks/use-tasks'
import type { ParentType } from '@/hooks/use-notes'

interface CreateTaskPopoverProps {
  parentType: ParentType
  parentId: string
}

/**
 * Quick "add task" popover for the board info panel. Just a title + date — optionally
 * tick "Add note?" to log a note saved alongside (and linked to) the task.
 */
export function CreateTaskPopover({ parentType, parentId }: CreateTaskPopoverProps) {
  const save = useCreateNoteAndTask()

  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [withNote, setWithNote] = useState(false)
  const [note, setNote] = useState('')

  const reset = () => {
    setTitle('')
    setDueDate('')
    setWithNote(false)
    setNote('')
  }

  const pending = save.isPending

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    try {
      const saved = await save.mutateAsync({
        parentType,
        parentId,
        note: withNote ? note : null,
        task: { title, due_date: dueDate },
      })
      toast.success(saved.note ? 'Task + note added' : 'Task added')
      reset()
      setOpen(false)
    } catch {
      toast.error('Could not add task')
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="flex-1">
          <CheckSquare className="size-4" />
          Task
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="new-task-title">Title</Label>
            <Input
              id="new-task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-task-due">Date</Label>
            <Input
              id="new-task-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={withNote} onCheckedChange={(v) => setWithNote(v === true)} />
            Add note?
          </label>
          {withNote && (
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Note saved with this task…"
            />
          )}
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={pending || !title.trim()}>
              {pending ? 'Saving…' : 'Add task'}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}
