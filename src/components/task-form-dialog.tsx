import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/hooks/use-auth'
import { useCreateTask, useUpdateTask } from '@/hooks/use-tasks'
import type { TaskWithContact } from '@/hooks/use-tasks'
import type { Enums } from '@/lib/database.types'

interface TaskFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  task?: TaskWithContact | null
}

export function TaskFormDialog({ open, onOpenChange, task }: TaskFormDialogProps) {
  const { session } = useAuth()
  const createTask = useCreateTask()
  const updateTask = useUpdateTask()
  const pending = createTask.isPending || updateTask.isPending

  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<Enums<'task_kind'>>('general')
  const [dueDate, setDueDate] = useState('')
  const [details, setDetails] = useState('')

  useEffect(() => {
    if (open) {
      setTitle(task?.title ?? '')
      setKind(task?.kind ?? 'general')
      setDueDate(task?.due_date ?? '')
      setDetails(task?.details ?? '')
    }
  }, [open, task])

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    const values = {
      title: title.trim(),
      kind,
      due_date: dueDate || null,
      details: details.trim() || null,
    }
    if (task) {
      updateTask.mutate(
        { id: task.id, ...values },
        {
          onSuccess: () => {
            toast.success('Task updated')
            onOpenChange(false)
          },
          onError: () => toast.error('Could not save task'),
        },
      )
    } else {
      if (!session?.user.id) return
      createTask.mutate(
        { ...values, owner_id: session.user.id },
        {
          onSuccess: () => {
            toast.success('Task added')
            onOpenChange(false)
          },
          onError: () => toast.error('Could not add task'),
        },
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{task ? 'Edit task' : 'Add task'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="task-title">Title</Label>
            <Input id="task-title" value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="task-kind">Type</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as Enums<'task_kind'>)}>
                <SelectTrigger id="task-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="general">Task</SelectItem>
                  <SelectItem value="follow_up">Follow-up</SelectItem>
                  <SelectItem value="renewal">Renewal</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="task-due">Due date</Label>
              <Input id="task-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="task-details">Details</Label>
            <Textarea id="task-details" rows={2} value={details} onChange={(e) => setDetails(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !title.trim()}>
              {pending ? 'Saving…' : task ? 'Save' : 'Add task'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
