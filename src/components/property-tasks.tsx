import { useEffect, useState } from 'react'
import { CalendarClock, Check, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  usePropertyTasks,
  useUpdateTourTime,
  useToggleTask,
  useDeleteTask,
  taskKindLabels,
  type PropertyTask,
} from '@/hooks/use-tasks'
import { clientLabel } from '@/hooks/use-suggestions'
import { formatDate } from '@/lib/dates'

function timeOf(dueAt: string | null): string {
  return dueAt ? new Date(dueAt).toTimeString().slice(0, 5) : ''
}

function TaskRow({ task }: { task: PropertyTask }) {
  const updateTime = useUpdateTourTime()
  const toggle = useToggleTask()
  const del = useDeleteTask()

  const initialTime = timeOf(task.due_at)
  const initialDate = task.due_date ?? ''
  const [time, setTime] = useState(initialTime)
  const [date, setDate] = useState(initialDate)
  useEffect(() => {
    setTime(initialTime)
    setDate(initialDate)
  }, [initialTime, initialDate])

  const commit = () => {
    if (time === initialTime && date === initialDate) return
    updateTime.mutate({
      taskId: task.id,
      pursuitId: task.pursuit_id,
      date: date || null,
      time: time || null,
    })
  }

  const who = clientLabel(task.pursuit?.client ?? null)

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 p-3">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <CalendarClock className="size-3.5 text-primary" />
          {taskKindLabels[task.kind]}
          <span className="font-normal text-muted-foreground">· {who}</span>
        </div>
        <div className="text-xs text-muted-foreground">{formatDate(task.due_date) ?? 'No date'}</div>
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
          onClick={() => toggle.mutate({ id: task.id, status: 'done' })}
          title="Mark done"
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

/** Open tasks (tours, follow-ups) for this property, with an editable tour time. */
export function PropertyTasks({ propertyId }: { propertyId: string }) {
  const { data: tasks = [] } = usePropertyTasks(propertyId)

  if (tasks.length === 0) {
    return <p className="text-sm text-muted-foreground">No open tours or tasks.</p>
  }

  return (
    <ul className="divide-y rounded-lg border">
      {tasks.map((t) => (
        <TaskRow key={t.id} task={t} />
      ))}
    </ul>
  )
}
