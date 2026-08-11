import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Check, ListChecks, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TaskCompleteDialog } from '@/components/task-complete-dialog'
import { taskKindLabels, useTask } from '@/hooks/use-tasks'
import { formatDate, formatTimeOfDay, isOverdue } from '@/lib/dates'
import { cn } from '@/lib/utils'

/**
 * The task you clicked, pinned to the top of the record you landed on.
 *
 * Clicking a task should answer "why is this on my list?" — so it drops you on the
 * contact or deal with the history right there, and keeps the task itself in view so
 * you can close it out without navigating back. Reads `?task=<id>`; renders nothing
 * without it, so every page can mount it unconditionally.
 */
export function TaskFocusBanner() {
  const [params, setParams] = useSearchParams()
  const taskId = params.get('task')
  const { data: task } = useTask(taskId ?? undefined)
  const [completing, setCompleting] = useState(false)

  const dismiss = () => {
    const next = new URLSearchParams(params)
    next.delete('task')
    setParams(next, { replace: true })
  }

  if (!taskId || !task || task.status === 'done') return null

  const overdue = isOverdue(task.due_date)

  return (
    <>
      <div
        className={cn(
          'flex flex-wrap items-start gap-3 rounded-lg border p-3',
          overdue ? 'border-red-200 bg-red-50' : 'border-primary/30 bg-primary/5',
        )}
      >
        <ListChecks
          className={cn('mt-0.5 size-4 shrink-0', overdue ? 'text-red-600' : 'text-primary')}
        />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Working this task
          </div>
          <div className="mt-0.5 text-sm font-medium">{task.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <Badge variant="outline" className="bg-card">
              {taskKindLabels[task.kind]}
            </Badge>
            {task.due_date && (
              <span className={cn(overdue && 'font-medium text-red-700')}>
                {overdue ? 'Overdue · ' : 'Due '}
                {formatDate(task.due_date)}
                {task.due_at ? ` · ${formatTimeOfDay(task.due_at)}` : ''}
              </span>
            )}
          </div>
          {task.details && (
            <p className="mt-1.5 whitespace-pre-line text-xs text-muted-foreground">{task.details}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button size="sm" onClick={() => setCompleting(true)}>
            <Check className="size-4" />
            Complete
          </Button>
          <Button variant="ghost" size="icon" className="size-8" onClick={dismiss} title="Dismiss">
            <X className="size-4" />
            <span className="sr-only">Dismiss task</span>
          </Button>
        </div>
      </div>

      <TaskCompleteDialog
        task={task}
        open={completing}
        onOpenChange={setCompleting}
        onCompleted={dismiss}
      />
    </>
  )
}
