import { useState } from 'react'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { SidebarSection } from '@/components/board-info-panel'
import { TaskCompleteDialog } from '@/components/task-complete-dialog'
import { useTasks, useToggleTask, type TaskWithContact } from '@/hooks/use-tasks'
import type { ParentType } from '@/hooks/use-notes'
import { formatDate, isOverdue } from '@/lib/dates'
import { cn } from '@/lib/utils'

const parentColumn = (t: ParentType) =>
  t === 'client' ? 'client_id' : t === 'listing' ? 'listing_id' : 'pursuit_id'

interface DealTasksProps {
  parentType: ParentType
  parentId: string
}

/**
 * Open tasks for this deal, shown on the About panel. Add tasks with the Task button
 * in the panel header — this section only lists/completes them.
 */
export function DealTasks({ parentType, parentId }: DealTasksProps) {
  const { data: tasks = [] } = useTasks()
  const toggle = useToggleTask()
  const [completing, setCompleting] = useState<TaskWithContact | null>(null)

  const column = parentColumn(parentType)
  const open = tasks
    .filter((t) => t.status === 'open' && t[column] === parentId)
    .sort((a, b) => ((a.due_date ?? '9999') < (b.due_date ?? '9999') ? -1 : 1))

  if (open.length === 0) return null

  return (
    <SidebarSection title="Tasks">
      <div className="space-y-1.5">
        {open.map((t) => {
          const overdue = isOverdue(t.due_date)
          return (
            <div
              key={t.id}
              className={cn(
                'flex items-start gap-2 rounded-lg border p-2.5 text-sm',
                overdue ? 'border-red-200 bg-red-50' : 'bg-card',
              )}
            >
              <Checkbox
                className="mt-0.5"
                checked={false}
                onCheckedChange={() => toggle.mutate({ id: t.id, status: 'done' })}
                aria-label="Mark task done"
              />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{t.title}</div>
                {t.due_date && (
                  <div
                    className={cn(
                      'mt-0.5 text-xs',
                      overdue ? 'font-medium text-red-700' : 'text-muted-foreground',
                    )}
                  >
                    {overdue ? 'Overdue · ' : ''}
                    {formatDate(t.due_date)}
                  </div>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 shrink-0"
                onClick={() => setCompleting(t)}
                title="Log the outcome and close this task"
              >
                <Check className="size-3.5" />
                Log
              </Button>
            </div>
          )
        })}
      </div>
      <TaskCompleteDialog
        task={completing}
        open={!!completing}
        onOpenChange={(o) => !o && setCompleting(null)}
      />
    </SidebarSection>
  )
}
