import { useMemo, useState } from 'react'
import { Check, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { TaskCompleteDialog } from '@/components/task-complete-dialog'
import { TaskFormDialog } from '@/components/task-form-dialog'
import { taskKindLabels, useTasks, useToggleTask, type TaskWithContact } from '@/hooks/use-tasks'
import { formatDate, formatTimeOfDay, isOverdue } from '@/lib/dates'
import { cn } from '@/lib/utils'

/**
 * This person's open tasks, sitting right above their conversation history — so the
 * page that explains why a task exists is also the page where you close it out and
 * set the next one.
 */
export function ContactTasks({ contactId }: { contactId: string }) {
  const { data: tasks = [] } = useTasks()
  const toggle = useToggleTask()
  const [completing, setCompleting] = useState<TaskWithContact | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  const open = useMemo(
    () =>
      tasks
        .filter((t) => t.status === 'open' && t.contact_id === contactId)
        .sort((a, b) => ((a.due_date ?? '9999') < (b.due_date ?? '9999') ? -1 : 1)),
    [tasks, contactId],
  )

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
                  'flex items-center gap-3 rounded-lg border p-3',
                  overdue ? 'border-red-200 bg-red-50' : 'bg-card',
                )}
              >
                <Checkbox
                  checked={false}
                  onCheckedChange={() => toggle.mutate({ id: task.id, status: 'done' })}
                  aria-label="Mark task done"
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
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 shrink-0"
                  onClick={() => setCompleting(task)}
                  title="Log the outcome and close this task"
                >
                  <Check className="size-3.5" />
                  Log
                </Button>
              </div>
            )
          })}
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
