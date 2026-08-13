import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { TaskCompleteDialog } from '@/components/task-complete-dialog'
import { TaskFormDialog } from '@/components/task-form-dialog'
import {
  taskKindLabels,
  useContactTasks,
  useToggleTask,
  type TaskWithContact,
} from '@/hooks/use-tasks'
import { formatDate, formatTimeOfDay, isOverdue } from '@/lib/dates'
import { cn } from '@/lib/utils'

/** How many completed tasks to show before asking. */
const RECENT_DONE = 5

/**
 * This person's tasks, sitting right above their conversation history — so the page
 * that explains why a task exists is also the page where you close it out and set the
 * next one.
 *
 * Completed tasks stay on the page rather than vanishing: what you already did about
 * someone is the context for what to do next, and for the imported HubSpot tasks the
 * note left on the task is often the only record of how the call went.
 */
export function ContactTasks({ contactId }: { contactId: string }) {
  const { data: tasks = [] } = useContactTasks(contactId)
  const toggle = useToggleTask()
  const [completing, setCompleting] = useState<TaskWithContact | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const [showAllDone, setShowAllDone] = useState(false)

  const { open, done } = useMemo(() => {
    const open = tasks
      .filter((t) => t.status === 'open')
      .sort((a, b) => ((a.due_date ?? '9999') < (b.due_date ?? '9999') ? -1 : 1))
    const done = tasks
      .filter((t) => t.status === 'done')
      .sort((a, b) => (a.completed_at ?? a.due_date ?? '') < (b.completed_at ?? b.due_date ?? '') ? 1 : -1)
    return { open, done }
  }, [tasks])

  const visibleDone = showAllDone ? done : done.slice(0, RECENT_DONE)

  return (
    <section className="max-w-2xl space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          Tasks{open.length > 0 && <span className="tabular-nums"> ({open.length})</span>}
        </h2>
        <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="size-4" />
          Add task
        </Button>
      </div>

      {open.length === 0 ? (
        <p className="text-sm text-muted-foreground">No open tasks for this contact.</p>
      ) : (
        <div className="space-y-2">
          {open.map((task) => {
            const overdue = isOverdue(task.due_date)
            return (
              <div
                key={task.id}
                className={cn(
                  'flex items-start gap-3 rounded-lg border p-3',
                  overdue ? 'border-red-200 bg-red-50' : 'bg-card',
                )}
              >
                <Checkbox
                  className="mt-0.5"
                  checked={false}
                  onCheckedChange={() => setCompleting(task)}
                  aria-label="Complete task"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{task.title}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <Badge variant="outline" className="bg-card">
                      {taskKindLabels[task.kind]}
                    </Badge>
                    {task.due_date && (
                      <span className={cn(overdue && 'font-medium text-red-700')}>
                        {overdue ? 'Overdue · ' : ''}
                        {formatDate(task.due_date)}
                        {task.due_at ? ` · ${formatTimeOfDay(task.due_at)}` : ''}
                      </span>
                    )}
                  </div>
                  {task.details && (
                    <p className="mt-1.5 whitespace-pre-wrap text-xs text-muted-foreground">
                      {task.details}
                    </p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {done.length > 0 && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setShowDone((v) => !v)}
            className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {showDone ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
            Completed <span className="tabular-nums">({done.length})</span>
          </button>

          {showDone && (
            <div className="space-y-2">
              {visibleDone.map((task) => (
                <div key={task.id} className="flex items-start gap-3 rounded-lg border bg-muted/30 p-3">
                  <Checkbox
                    className="mt-0.5"
                    checked
                    onCheckedChange={() => toggle.mutate({ id: task.id, status: 'open' })}
                    aria-label="Reopen task"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-muted-foreground line-through">
                      {task.title}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <Badge variant="outline" className="bg-card">
                        {taskKindLabels[task.kind]}
                      </Badge>
                      <span>
                        {task.completed_at
                          ? `Done ${formatDate(task.completed_at)}`
                          : /* Imported rows can carry a status with no timestamp. */
                            'Done'}
                      </span>
                    </div>
                    {task.details && (
                      <p className="mt-1.5 whitespace-pre-wrap text-xs text-muted-foreground">
                        {task.details}
                      </p>
                    )}
                  </div>
                </div>
              ))}

              {done.length > RECENT_DONE && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setShowAllDone((v) => !v)}
                >
                  {showAllDone ? 'Show less' : `Show all ${done.length}`}
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      <TaskCompleteDialog
        task={completing}
        open={!!completing}
        onOpenChange={(o) => !o && setCompleting(null)}
      />
      <TaskFormDialog open={addOpen} onOpenChange={setAddOpen} attachTo={{ contact_id: contactId }} />
    </section>
  )
}
