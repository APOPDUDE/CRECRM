import { useState } from 'react'
import { useResetOn } from '@/hooks/use-reset-on'
import { CalendarClock, Check, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { TaskCompleteDialog } from '@/components/task-complete-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  usePropertyTasks,
  useUpdateTourTime,
  useDeleteTask,
  taskKindLabels,
  type PropertyTask,
} from '@/hooks/use-tasks'
import { clientLabel } from '@/hooks/use-suggestions'
import { formatDate, isOverdue } from '@/lib/dates'
import { cn } from '@/lib/utils'

function timeOf(dueAt: string | null): string {
  return dueAt ? new Date(dueAt).toTimeString().slice(0, 5) : ''
}

function TaskRow({ task, onComplete }: { task: PropertyTask; onComplete: (t: PropertyTask) => void }) {
  const updateTime = useUpdateTourTime()
  const del = useDeleteTask()

  const initialTime = timeOf(task.due_at)
  const initialDate = task.due_date ?? ''
  const [time, setTime] = useState(initialTime)
  const [date, setDate] = useState(initialDate)
  useResetOn([initialTime, initialDate], () => {
    setTime(initialTime)
    setDate(initialDate)
  })

  const commit = () => {
    if (time === initialTime && date === initialDate) return
    updateTime.mutate({
      taskId: task.id,
      pursuitId: task.pursuit_id,
      date: date || null,
      time: time || null,
    })
  }

  // A deal's tour names the tenant; a task raised from this page has no deal to name.
  const who = task.pursuit ? clientLabel(task.pursuit.client ?? null) : null
  const overdue = isOverdue(task.due_date)

  return (
    <li className={cn('flex flex-wrap items-center justify-between gap-3 p-3', overdue && 'bg-red-50')}>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <CalendarClock className={cn('size-3.5', overdue ? 'text-red-600' : 'text-primary')} />
          <span className="truncate">{task.title}</span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <Badge variant="outline" className="bg-card">
            {taskKindLabels[task.kind]}
          </Badge>
          {who && <span>· {who}</span>}
          <span className={cn(overdue && 'font-medium text-red-700')}>
            {overdue ? 'Overdue · ' : ''}
            {formatDate(task.due_date) ?? 'No date'}
          </span>
        </div>
        {task.details && (
          <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{task.details}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          onBlur={commit}
          className="w-36"
          aria-label="Tour date"
        />
        <Input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          onBlur={commit}
          className="w-28"
          aria-label="Tour time"
        />
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={() => onComplete(task)}
          title="Complete"
        >
          <Check className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:text-destructive"
          onClick={() => del.mutate(task.id)}
          title="Delete"
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </li>
  )
}

/**
 * Open tasks for this property — ones raised from this page plus any deal's tours and
 * follow-ups on it — with an editable date/time. Completing goes through the same
 * outcome dialog as the task list (done / done with a follow-up / push the date), so a
 * task closed here behaves exactly like one closed anywhere else.
 */
export function PropertyTasks({ propertyId }: { propertyId: string }) {
  const { data: tasks = [] } = usePropertyTasks(propertyId)
  const [completing, setCompleting] = useState<PropertyTask | null>(null)

  return (
    <>
      {tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">No open tours or tasks. Add task above to set one.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {tasks.map((t) => (
            <TaskRow key={t.id} task={t} onComplete={setCompleting} />
          ))}
        </ul>
      )}
      <TaskCompleteDialog
        task={completing}
        open={!!completing}
        onOpenChange={(o) => !o && setCompleting(null)}
      />
    </>
  )
}
