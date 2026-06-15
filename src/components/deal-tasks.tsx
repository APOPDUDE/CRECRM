import { Checkbox } from '@/components/ui/checkbox'
import { SidebarSection } from '@/components/board-info-panel'
import { useTasks, useToggleTask } from '@/hooks/use-tasks'
import type { Enums } from '@/lib/database.types'
import { formatDate, isOverdue } from '@/lib/dates'
import { cn } from '@/lib/utils'

interface DealTasksProps {
  entityType: Extract<Enums<'note_entity'>, 'listing' | 'tenant_rep'>
  entityId: string
}

/**
 * Open tasks for this deal, shown on the About panel. Add tasks with the Task button
 * in the panel header — this section only lists/completes them.
 */
export function DealTasks({ entityType, entityId }: DealTasksProps) {
  const { data: tasks = [] } = useTasks()
  const toggle = useToggleTask()

  const open = tasks
    .filter((t) => t.status === 'open' && t.entity_type === entityType && t.entity_id === entityId)
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
            </div>
          )
        })}
      </div>
    </SidebarSection>
  )
}
