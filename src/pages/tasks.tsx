import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
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
  Check,
  ChevronLeft,
  ChevronRight,
  List as ListIcon,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog'
import { ListErrorState } from '@/components/list-error-state'
import { PaymentCheckActions } from '@/components/payment-check-actions'
import { TaskCompleteDialog } from '@/components/task-complete-dialog'
import { TaskFormDialog } from '@/components/task-form-dialog'
import { contactNameOf } from '@/hooks/use-contacts'
import {
  paymentRungMessage,
  useDeleteTask,
  usePaymentCheckAnswer,
  useTasks,
  useToggleTask,
  taskHref,
  taskKindLabels,
  taskTarget,
} from '@/hooks/use-tasks'
import type { TaskWithContact } from '@/hooks/use-tasks'
import type { Enums } from '@/lib/database.types'
import { formatDate, formatTimeOfDay, isOverdue } from '@/lib/dates'
import { cn } from '@/lib/utils'

const kindBadgeClass: Record<string, string> = {
  renewal: 'bg-purple-50 text-purple-700 border-purple-200',
  follow_up: 'bg-blue-50 text-blue-700 border-blue-200',
  tour: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  general: 'bg-gray-50 text-gray-600 border-gray-200',
}

type KindFilter = Enums<'task_kind'> | 'all'

const KIND_FILTERS: { value: KindFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'follow_up', label: 'Follow-ups' },
  { value: 'renewal', label: 'Renewals' },
  { value: 'tour', label: 'Tours' },
  { value: 'general', label: 'Tasks' },
]

type Bucket = { key: string; label: string; tone: string; tasks: TaskWithContact[] }

export function TasksPage() {
  const navigate = useNavigate()
  const { data: tasks = [], isLoading, isError, refetch } = useTasks()
  const toggle = useToggleTask()
  const deleteTask = useDeleteTask()
  const paymentAnswer = usePaymentCheckAnswer()

  const [view, setView] = useState<'list' | 'calendar'>('list')
  const [showDone, setShowDone] = useState(false)
  const [search, setSearch] = useState('')
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  const [month, setMonth] = useState(() => startOfMonth(new Date()))
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<TaskWithContact | null>(null)
  const [deleting, setDeleting] = useState<TaskWithContact | null>(null)
  const [completing, setCompleting] = useState<TaskWithContact | null>(null)

  const openCreate = () => {
    setEditing(null)
    setFormOpen(true)
  }
  const openEdit = (task: TaskWithContact) => {
    setEditing(task)
    setFormOpen(true)
  }
  /** Open the record behind the task, with the task pinned to the top of it. */
  const openTaskRecord = (task: TaskWithContact) => {
    const href = taskHref(task)
    if (href) navigate(href)
    else openEdit(task)
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return tasks.filter((t) => {
      if (kindFilter !== 'all' && t.kind !== kindFilter) return false
      if (!q) return true
      const who = t.contact ? contactNameOf(t.contact) : ''
      return `${t.title} ${who} ${t.details ?? ''}`.toLowerCase().includes(q)
    })
  }, [tasks, search, kindFilter])

  /** Overdue first, then the near horizon — the order you'd actually work them in. */
  const buckets = useMemo<Bucket[]>(() => {
    const today = format(new Date(), 'yyyy-MM-dd')
    const weekEnd = format(endOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
    const open = filtered.filter((t) => t.status === 'open')
    const due = (t: TaskWithContact) => t.due_date as string
    const out: Bucket[] = [
      {
        key: 'overdue',
        label: 'Overdue',
        tone: 'bg-red-50 text-red-700',
        tasks: open.filter((t) => t.due_date && due(t) < today),
      },
      {
        key: 'today',
        label: 'Today',
        tone: 'bg-amber-50 text-amber-700',
        tasks: open.filter((t) => due(t) === today),
      },
      {
        key: 'week',
        label: 'This week',
        tone: 'bg-muted text-muted-foreground',
        tasks: open.filter((t) => t.due_date && due(t) > today && due(t) <= weekEnd),
      },
      {
        key: 'later',
        label: 'Later',
        tone: 'bg-muted text-muted-foreground',
        tasks: open.filter((t) => t.due_date && due(t) > weekEnd),
      },
      {
        key: 'undated',
        label: 'No date',
        tone: 'bg-muted text-muted-foreground',
        tasks: open.filter((t) => !t.due_date),
      },
    ]
    if (showDone) {
      out.push({
        key: 'done',
        label: 'Completed',
        tone: 'bg-muted text-muted-foreground',
        tasks: filtered
          .filter((t) => t.status === 'done')
          .sort((a, b) => ((a.completed_at ?? '') < (b.completed_at ?? '') ? 1 : -1))
          .slice(0, 50),
      })
    }
    return out.filter((b) => b.tasks.length > 0)
  }, [filtered, showDone])

  const openCount = filtered.filter((t) => t.status === 'open').length

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
    const target = taskTarget(task)
    const isPaymentCheck =
      task.source === 'payment_check' && task.status === 'open' && !!task.pursuit_id
    return (
      <div
        role={target ? 'button' : undefined}
        tabIndex={target ? 0 : undefined}
        onClick={() => target && openTaskRecord(task)}
        onKeyDown={(e) => {
          if (target && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            openTaskRecord(task)
          }
        }}
        className={cn(
          'flex items-center gap-3 border-b px-3 py-2.5 transition-colors last:border-b-0',
          target && 'cursor-pointer hover:bg-accent/50',
        )}
      >
        <div onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={task.status === 'done'}
            onCheckedChange={(v) => {
              // Completing an unanswered payment reminder = "not received yet": seed the
              // next check (2 weeks out) instead of silently closing it. "Received" stops it.
              if (v === true && isPaymentCheck) {
                if (paymentAnswer.isPending) return // a double-click must not seed two reminders
                paymentAnswer.mutate(
                  { task, received: false },
                  {
                    onSuccess: (rung) => toast.success(paymentRungMessage(rung)),
                    onError: () => toast.error('Could not set reminder'),
                  },
                )
              } else {
                toggle.mutate({ id: task.id, status: v === true ? 'done' : 'open' })
              }
            }}
            aria-label="Toggle complete"
          />
        </div>

        <div className="min-w-0 flex-1">
          <div
            className={cn(
              'truncate text-sm font-medium',
              task.status === 'done' && 'text-muted-foreground line-through',
            )}
          >
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
            {task.contact && <span className="truncate">· {contactNameOf(task.contact)}</span>}
          </div>
        </div>

        {target && (
          <span className="hidden shrink-0 items-center gap-0.5 text-xs text-primary sm:flex">
            {target.label}
            <ChevronRight className="size-3.5" />
          </span>
        )}
        <div className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          {isPaymentCheck ? (
            <PaymentCheckActions task={task} />
          ) : (
            task.status === 'open' && (
              <Button
                size="sm"
                variant="outline"
                className="h-7"
                onClick={() => setCompleting(task)}
                title="Log the outcome and close this task"
              >
                <Check className="size-3.5" />
                <span className="hidden sm:inline">Log</span>
              </Button>
            )
          )}
          {rowMenu(task)}
        </div>
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
    for (const t of filtered) {
      if (!t.due_date) continue
      const key = t.due_date
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(t)
    }
    return map
  }, [filtered])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">
          Tasks{' '}
          <span className="text-base font-normal text-muted-foreground tabular-nums">{openCount}</span>
        </h1>
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

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tasks and people…"
            className="pl-8"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {KIND_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setKindFilter(f.value)}
              className={cn(
                'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                kindFilter === f.value
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent',
              )}
            >
              {f.label}
            </button>
          ))}
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
        buckets.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
            <p className="text-sm text-muted-foreground">
              {search || kindFilter !== 'all'
                ? 'No tasks match that filter.'
                : 'No open tasks — you’re all caught up.'}
            </p>
            <Button onClick={openCreate}>
              <Plus className="size-4" />
              Add task
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {buckets.map((bucket) => (
              <div key={bucket.key} className="overflow-hidden rounded-lg border bg-card">
                <div className={cn('px-3 py-1.5 text-xs font-semibold', bucket.tone)}>
                  {bucket.label} · {bucket.tasks.length}
                </div>
                {bucket.tasks.map((task) => (
                  <TaskRow key={task.id} task={task} />
                ))}
              </div>
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
                          onClick={() => openTaskRecord(t)}
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
      <TaskCompleteDialog
        task={completing}
        open={!!completing}
        onOpenChange={(open) => !open && setCompleting(null)}
      />
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
