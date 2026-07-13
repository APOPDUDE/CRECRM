import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { addDays, endOfWeek, format, parseISO } from 'date-fns'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { formatCurrency } from '@/lib/format'
import { matchFee, type DashMatch } from '@/hooks/use-dashboard'
import { daysAgoLabel, formatDate } from '@/lib/dates'
import { contactNameOf } from '@/hooks/use-contacts'
import { Checkbox } from '@/components/ui/checkbox'
import { toast } from 'sonner'
import { PaymentCheckActions } from '@/components/payment-check-actions'
import {
  paymentRungMessage,
  taskDealPath,
  taskKindLabels,
  usePaymentCheckAnswer,
  useTasks,
  useToggleTask,
  type TaskWithContact,
} from '@/hooks/use-tasks'
import { activityRows, recentPeriods, METRIC_LABELS, type Gran } from '@/lib/activity'

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  )
}

export function DashboardActivity({ matches }: { matches: DashMatch[] }) {
  const [gran, setGran] = useState<Gran>('week')

  const stats = useMemo(() => {
    const now = new Date()
    const ytdStart = new Date(now.getFullYear(), 0, 1)
    const d90 = new Date(now.getTime() - 90 * 86400000)
    let active = 0
    let exec90 = 0
    let commissionYtd = 0
    let flagged = 0
    for (const m of matches) {
      if (m.stage !== 'passed' && m.stage !== 'executed') active++
      if (m.flagged_new) flagged++
      if (m.executed_date) {
        const ed = parseISO(m.executed_date)
        if (ed >= d90) exec90++
        if (ed >= ytdStart) commissionYtd += matchFee(m)
      }
    }
    return { active, exec90, commissionYtd, flagged }
  }, [matches])

  const navigate = useNavigate()
  const data = useMemo(() => activityRows(matches, recentPeriods(gran, 5), gran), [matches, gran])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Active deals" value={String(stats.active)} />
        <StatCard label="Executed (90d)" value={String(stats.exec90)} />
        <StatCard label="Commission (YTD)" value={formatCurrency(stats.commissionYtd) ?? '$0'} />
        <StatCard label="New matches" value={String(stats.flagged)} />
      </div>

      <div
        role="button"
        tabIndex={0}
        onClick={() => navigate('/activity')}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && navigate('/activity')}
        className="cursor-pointer rounded-lg border bg-card transition-colors hover:border-primary/40"
        title="See all activity, week by week"
      >
        <div className="flex items-center justify-between border-b p-3">
          <h2 className="text-sm font-medium">Activity</h2>
          <div className="flex items-center gap-2">
            <div
              className="flex gap-1 rounded-md bg-muted p-0.5 text-xs"
              onClick={(e) => e.stopPropagation()}
            >
              {(['week', 'month'] as Gran[]).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGran(g)}
                  className={cn(
                    'rounded px-2 py-1 font-medium capitalize transition-colors',
                    gran === g ? 'bg-background shadow-sm' : 'text-muted-foreground',
                  )}
                >
                  {g === 'week' ? 'Weekly' : 'Monthly'}
                </button>
              ))}
            </div>
            <span className="text-xs font-medium text-primary">View all →</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="px-3 py-2 text-left font-medium">{gran === 'week' ? 'Week of' : 'Month'}</th>
                {METRIC_LABELS.map((m) => (
                  <th key={m} className="px-3 py-2 text-right font-medium">
                    {m}
                  </th>
                ))}
                <th className="px-3 py-2 text-right font-medium">Commission</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row, i) => (
                <tr
                  key={i}
                  className={cn('border-b last:border-0', row.isCurrent && 'bg-emerald-50/70')}
                  style={{ opacity: 1 - i * 0.15 }}
                >
                  <td
                    className={cn(
                      'px-3 py-2',
                      row.isCurrent ? 'font-medium text-emerald-800' : 'text-muted-foreground',
                    )}
                  >
                    {row.label}
                    {row.isCurrent && (
                      <span className="ml-1.5 text-xs font-normal text-emerald-600">now</span>
                    )}
                  </td>
                  {row.metrics.map((c, mi) => (
                    <td
                      key={mi}
                      className={cn(
                        'px-3 py-2 text-right tabular-nums',
                        c === 0 && !row.isCurrent && 'text-muted-foreground/40',
                      )}
                    >
                      {c}
                    </td>
                  ))}
                  <td
                    className={cn(
                      'px-3 py-2 text-right font-medium tabular-nums',
                      row.commission === 0 && 'font-normal text-muted-foreground/40',
                    )}
                  >
                    {row.commission > 0 ? formatCurrency(row.commission) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export function NewMatchesFeed({ matches }: { matches: DashMatch[] }) {
  const feed = useMemo(
    () =>
      matches
        .filter((m) => m.flagged_new || m.stage === 'inquiring')
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
        .slice(0, 12),
    [matches],
  )

  return (
    <div className="flex h-full flex-col rounded-lg border bg-card">
      <h2 className="border-b p-3 text-sm font-medium">New matched listings</h2>
      {feed.length === 0 ? (
        <p className="p-3 text-sm text-muted-foreground">
          No new matched listings — they'll appear here as the daily sweep and searches run.
        </p>
      ) : (
        <ul className="divide-y overflow-y-auto">
          {feed.map((m) => {
            const who =
              m.tenant_company?.name ??
              (m.tenant_contact ? contactNameOf(m.tenant_contact) : null)
            const days = daysAgoLabel(m.created_at)
            return (
              <li key={m.id}>
                <Link
                  to={m.tenant_rep_id ? `/tenant-rep/${m.tenant_rep_id}` : '#'}
                  className="flex items-start justify-between gap-2 p-3 transition-colors hover:bg-accent"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {m.property?.address ?? 'Property'}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {[m.property?.city, m.property?.state].filter(Boolean).join(', ')}
                      {who ? ` · ${who}` : ''}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {m.flagged_new && (
                      <Badge
                        variant="outline"
                        className="border-red-200 bg-red-50 font-medium text-red-700"
                      >
                        New
                      </Badge>
                    )}
                    {days && (
                      <span className="text-xs text-muted-foreground">
                        {days === 'today' ? 'today' : `${days}d`}
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

type TaskTone = 'overdue' | 'today' | 'upcoming'

function TaskRow({ task, tone }: { task: TaskWithContact; tone: TaskTone }) {
  const navigate = useNavigate()
  const toggle = useToggleTask()
  const paymentAnswer = usePaymentCheckAnswer()
  // Fall back to the Tasks page so match-attached tasks (no standalone route) never dead-end.
  const path = taskDealPath(task) ?? '/tasks'
  const who = task.contact ? contactNameOf(task.contact) : null
  const isPaymentCheck = task.source === 'payment_check' && task.status === 'open' && !!task.pursuit_id
  return (
    <li
      className={cn(
        'flex flex-wrap items-center gap-x-2.5 gap-y-1.5 px-3 py-2',
        tone === 'overdue' ? 'bg-red-50/60' : tone === 'today' ? 'bg-amber-50/50' : '',
      )}
    >
      <Checkbox
        checked={task.status === 'done'}
        onCheckedChange={(v) => {
          // Checking off an unanswered payment reminder = "not received yet": seed the
          // next check instead of silently ending the follow-up chain.
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
        aria-label="Mark task done"
      />
      <button
        type="button"
        onClick={() => navigate(path)}
        className="min-w-0 flex-1 text-left"
      >
        <div className="truncate text-sm font-medium">{task.title}</div>
        <div className="truncate text-xs text-muted-foreground">
          {taskKindLabels[task.kind]}
          {who ? ` · ${who}` : ''}
        </div>
      </button>
      <span
        className={cn(
          'shrink-0 text-xs font-medium tabular-nums',
          tone === 'overdue'
            ? 'text-red-700'
            : tone === 'today'
              ? 'text-amber-700'
              : 'text-muted-foreground',
        )}
      >
        {task.due_date ? formatDate(task.due_date) : ''}
      </span>
      <PaymentCheckActions task={task} />
    </li>
  )
}

const HORIZON_DAYS = 14

/** Upcoming tasks for the next 14 days, grouped Overdue → Today → This week → Later. */
export function TasksDueWidget() {
  const { data: tasks = [] } = useTasks()

  const groups = useMemo(() => {
    const today = format(new Date(), 'yyyy-MM-dd')
    const horizon = format(addDays(new Date(), HORIZON_DAYS), 'yyyy-MM-dd')
    const weekEnd = format(endOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
    const open = tasks.filter(
      (t) => t.status === 'open' && t.due_date && (t.due_date as string) <= horizon,
    )
    const d = (t: TaskWithContact) => t.due_date as string
    return {
      overdue: open.filter((t) => d(t) < today),
      today: open.filter((t) => d(t) === today),
      thisWeek: open.filter((t) => d(t) > today && d(t) <= weekEnd),
      later: open.filter((t) => d(t) > weekEnd),
    }
  }, [tasks])

  const total =
    groups.overdue.length + groups.today.length + groups.thisWeek.length + groups.later.length

  const sections: { key: TaskTone; label: string; items: TaskWithContact[]; head: string }[] = [
    { key: 'overdue', label: `Overdue · ${groups.overdue.length}`, items: groups.overdue, head: 'bg-red-50 text-red-700' },
    { key: 'today', label: `Today · ${groups.today.length}`, items: groups.today, head: 'bg-amber-50 text-amber-700' },
    { key: 'upcoming', label: `This week · ${groups.thisWeek.length}`, items: groups.thisWeek, head: 'bg-muted text-muted-foreground' },
    { key: 'upcoming', label: `Later · ${groups.later.length}`, items: groups.later, head: 'bg-muted text-muted-foreground' },
  ]

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b p-3">
        <h2 className="text-sm font-medium">Upcoming tasks</h2>
        <Link to="/tasks" className="text-xs text-primary hover:underline">
          View all
        </Link>
      </div>
      {total === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-muted-foreground">
          You're all caught up for the next {HORIZON_DAYS} days.
        </p>
      ) : (
        sections
          .filter((s) => s.items.length > 0)
          .map((s, i) => (
            <div key={i}>
              <div className={cn('px-3 py-1.5 text-xs font-semibold', s.head)}>{s.label}</div>
              <ul className="divide-y">
                {s.items.map((t) => (
                  <TaskRow key={t.id} task={t} tone={s.key} />
                ))}
              </ul>
            </div>
          ))
      )}
    </div>
  )
}
