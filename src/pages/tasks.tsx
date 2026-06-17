import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns'
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  List as ListIcon,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog'
import { ListErrorState } from '@/components/list-error-state'
import { TaskFormDialog } from '@/components/task-form-dialog'
import { contactNameOf } from '@/hooks/use-contacts'
import { useDeleteTask, useTasks, useToggleTask, taskDealPath, taskKindLabels } from '@/hooks/use-tasks'
import type { TaskWithContact } from '@/hooks/use-tasks'
import { formatDate, formatTimeOfDay, isOverdue } from '@/lib/dates'
import { cn } from '@/lib/utils'

const kindBadgeClass: Record<string, string> = {
  renewal: 'bg-purple-50 text-purple-700 border-purple-200',
  follow_up: 'bg-blue-50 text-blue-700 border-blue-200',
  general: 'bg-gray-50 text-gray-600 border-gray-200',
}

export function TasksPage() {
  const navigate = useNavigate()
  const { data: tasks = [], isLoading, isError, refetch } = useTasks()
  const toggle = useToggleTask()
  const deleteTask = useDeleteTask()
  const queryClient = useQueryClient()

  const markPaymentReceived = async (task: TaskWithContact) => {
    if (!task.pursuit_id) return
    const { error } = await supabase
      .from('pursuits')
      .update({ payment_received: true })
      .eq('id', task.pursuit_id)
    if (error) {
      toast.error('Could not update payment')
      return
    }
    toggle.mutate({ id: task.id, status: 'done' })
    queryClient.invalidateQueries({ queryKey: ['dashboard-matches'] })
    queryClient.invalidateQueries({ queryKey: ['matches'] })
    toast.success('Payment marked received')
  }

  // Not received yet: close this check and seed a fresh reminder 30 days out.
  const markPaymentNotReceived = async (task: TaskWithContact) => {
    if (!task.pursuit_id) return
    const { error } = await supabase.from('tasks').insert({
      owner_id: task.owner_id,
      title: task.title,
      kind: 'follow_up',
      status: 'open',
      due_date: format(addDays(new Date(), 30), 'yyyy-MM-dd'),
      pursuit_id: task.pursuit_id,
      auto_generated: true,
      source: 'payment_check',
    })
    if (error) {
      toast.error('Could not set reminder')
      return
    }
    toggle.mutate({ id: task.id, status: 'done' })
    queryClient.invalidateQueries({ queryKey: ['tasks'] })
    toast.success('Reminder set for 30 days')
  }

  const [view, setView] = useState<'list' | 'calendar'>('list')
  const [showDone, setShowDone] = useState(false)
  const [month, setMonth] = useState(() => startOfMonth(new Date()))
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<TaskWithContact | null>(null)
  const [deleting, setDeleting] = useState<TaskWithContact | null>(null)

  const openTasks = useMemo(() => tasks.filter((t) => t.status === 'open'), [tasks])
  const visibleList = showDone ? tasks : openTasks

  const openCreate = () => {
    setEditing(null)
    setFormOpen(true)
  }
  const openEdit = (task: TaskWithContact) => {
    setEditing(task)
    setFormOpen(true)
  }
  const goToDeal = (task: TaskWithContact) => {
    const path = taskDealPath(task)
    if (path) navigate(path)
  }
  const confirmDelete = () => {
    if (!deleting) return
    deleteTask.mutate(deleting.id, {
      onSuccess: () => {
        toast.success('Task deleted')
        setDeleting(null)
      },
      onError: () => {
        toast.error('Could not delete task')
        setDeleting(null)
      },
    })
  }

  const rowMenu = (task: TaskWithContact) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-7 shrink-0" onClick={(e) => e.stopPropagation()}>
          <MoreHorizontal className="size-4" />
          <span className="sr-only">Task actions</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onSelect={() => openEdit(task)}>
          <Pencil className="size-4" />
          Edit
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(task)}>
          <Trash2 className="size-4" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  const TaskRow = ({ task }: { task: TaskWithContact }) => {
    const overdue = task.status === 'open' && isOverdue(task.due_date)
    const path = taskDealPath(task)
    return (
      <div className="flex items-center gap-3 rounded-lg border bg-card p-3">
        <Checkbox
          checked={task.status === 'done'}
          onCheckedChange={(v) => toggle.mutate({ id: task.id, status: v === true ? 'done' : 'open' })}
          aria-label="Toggle complete"
        />
        <button
          type="button"
          onClick={() => path && goToDeal(task)}
          className={cn('min-w-0 flex-1 text-left', path && 'cursor-pointer')}
        >
          <div className={cn('truncate text-sm font-medium', task.status === 'done' && 'text-muted-foreground line-through')}>
            {task.title}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <Badge variant="outline" className={kindBadgeClass[task.kind]}>
              {taskKindLabels[task.kind]}
            </Badge>
            {task.due_date && (
              <span className={cn(overdue && 'font-medium text-red-600')}>
                {overdue ? 'Overdue · ' : ''}
                {formatDate(task.due_date)}
                {task.due_at ? ` · ${formatTimeOfDay(task.due_at)}` : ''}
              </span>
            )}
            {task.contact && <span>· {contactNameOf(task.contact)}</span>}
            {path && <span className="text-primary">· Open deal</span>}
          </div>
        </button>
        {task.source === 'payment_check' && task.status === 'open' && task.pursuit_id && (
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              onClick={(e) => {
                e.stopPropagation()
                void markPaymentReceived(task)
              }}
            >
              Received
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-muted-foreground"
              onClick={(e) => {
                e.stopPropagation()
                void markPaymentNotReceived(task)
              }}
            >
              Not yet
            </Button>
          </div>
        )}
        {rowMenu(task)}
      </div>
    )
  }

  // Calendar grid (full weeks covering the month)
  const calendarDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(month))
    const end = endOfWeek(endOfMonth(month))
    return eachDayOfInterval({ start, end })
  }, [month])
  const tasksByDay = useMemo(() => {
    const map = new Map<string, TaskWithContact[]>()
    for (const t of tasks) {
      if (!t.due_date) continue
      const key = t.due_date
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(t)
    }
    return map
  }, [tasks])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Tasks</h1>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Checkbox checked={showDone} onCheckedChange={(v) => setShowDone(v === true)} />
            Show completed
          </label>
          <div className="flex rounded-md border p-0.5">
            <Button variant={view === 'list' ? 'secondary' : 'ghost'} size="icon" className="size-7" onClick={() => setView('list')}>
              <ListIcon className="size-4" />
              <span className="sr-only">List view</span>
            </Button>
            <Button variant={view === 'calendar' ? 'secondary' : 'ghost'} size="icon" className="size-7" onClick={() => setView('calendar')}>
              <CalendarDays className="size-4" />
              <span className="sr-only">Calendar view</span>
            </Button>
          </div>
          <Button onClick={openCreate}>
            <Plus className="size-4" />
            <span className="hidden sm:inline">Add task</span>
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : isError ? (
        <ListErrorState message="Could not load tasks." onRetry={() => refetch()} />
      ) : view === 'list' ? (
        visibleList.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
            <p className="text-sm text-muted-foreground">
              {showDone ? 'No tasks yet.' : 'No open tasks — you’re all caught up.'}
            </p>
            <Button onClick={openCreate}>
              <Plus className="size-4" />
              Add task
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {visibleList.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </div>
        )
      ) : (
        <div className="rounded-lg border">
          <div className="flex items-center justify-between border-b p-3">
            <div className="text-sm font-medium">{format(month, 'MMMM yyyy')}</div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="size-7" onClick={() => setMonth(subMonths(month, 1))}>
                <ChevronLeft className="size-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setMonth(startOfMonth(new Date()))}>
                Today
              </Button>
              <Button variant="ghost" size="icon" className="size-7" onClick={() => setMonth(addMonths(month, 1))}>
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-7 border-b text-center text-xs text-muted-foreground">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
              <div key={d} className="py-1.5">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {calendarDays.map((day) => {
              const dayTasks = tasksByDay.get(format(day, 'yyyy-MM-dd')) ?? []
              return (
                <div
                  key={day.toISOString()}
                  className={cn(
                    'min-h-20 border-b border-r p-1 text-xs [&:nth-child(7n)]:border-r-0',
                    !isSameMonth(day, month) && 'bg-muted/30 text-muted-foreground',
                  )}
                >
                  <div className={cn('mb-1 text-right', isToday(day) && 'font-bold text-primary')}>
                    {format(day, 'd')}
                  </div>
                  <div className="space-y-1">
                    {dayTasks.map((t) => {
                      const overdue = t.status === 'open' && isOverdue(t.due_date)
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => (taskDealPath(t) ? goToDeal(t) : openEdit(t))}
                          title={t.title}
                          className={cn(
                            'block w-full truncate rounded px-1 py-0.5 text-left',
                            t.status === 'done'
                              ? 'bg-muted text-muted-foreground line-through'
                              : overdue
                                ? 'bg-red-100 text-red-700'
                                : 'bg-primary/10 text-primary',
                          )}
                        >
                          {t.title}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <TaskFormDialog open={formOpen} onOpenChange={setFormOpen} task={editing} />
      <ConfirmDeleteDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete task?"
        description={`“${deleting?.title}” will be permanently deleted.`}
        pending={deleteTask.isPending}
        onConfirm={confirmDelete}
      />
    </div>
  )
}
