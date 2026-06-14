import { useState } from 'react'
import type { FormEvent } from 'react'
import { CheckSquare } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/hooks/use-auth'
import { useCreateTask } from '@/hooks/use-tasks'
import type { Enums } from '@/lib/database.types'

interface CreateTaskPopoverProps {
  entityType: Extract<Enums<'note_entity'>, 'listing' | 'tenant_rep'>
  entityId: string
}

/** Quick "add task" popover for the board info panel — sits next to Upload file / Log note. */
export function CreateTaskPopover({ entityType, entityId }: CreateTaskPopoverProps) {
  const { session } = useAuth()
  const createTask = useCreateTask()

  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<Enums<'task_kind'>>('general')
  const [dueDate, setDueDate] = useState('')
  const [details, setDetails] = useState('')

  const reset = () => {
    setTitle('')
    setKind('general')
    setDueDate('')
    setDetails('')
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!session?.user.id || !title.trim()) return
    createTask.mutate(
      {
        owner_id: session.user.id,
        title: title.trim(),
        kind,
        due_date: dueDate || null,
        details: details.trim() || null,
        entity_type: entityType,
        entity_id: entityId,
        status: 'open',
        auto_generated: false,
      },
      {
        onSuccess: () => {
          toast.success('Task added')
          reset()
          setOpen(false)
        },
        onError: () => toast.error('Could not add task'),
      },
    )
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
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="new-task-kind">Type</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as Enums<'task_kind'>)}>
                <SelectTrigger id="new-task-kind" className="w-full">
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
              <Label htmlFor="new-task-due">Due date</Label>
              <Input
                id="new-task-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-task-details">Details</Label>
            <Textarea
              id="new-task-details"
              rows={2}
              value={details}
              onChange={(e) => setDetails(e.target.value)}
            />
          </div>
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={createTask.isPending || !title.trim()}>
              {createTask.isPending ? 'Saving…' : 'Add task'}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}
