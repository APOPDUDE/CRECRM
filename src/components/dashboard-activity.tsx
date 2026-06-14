import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  format,
  isSameMonth,
  isSameWeek,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
  subWeeks,
} from 'date-fns'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { formatCurrency } from '@/lib/format'
import { matchFee, type DashMatch } from '@/hooks/use-dashboard'
import { daysAgoLabel, formatDate } from '@/lib/dates'
import { contactNameOf } from '@/hooks/use-contacts'
import { Checkbox } from '@/components/ui/checkbox'
import {
  taskDealPath,
  taskKindLabels,
  useTasks,
  useToggleTask,
  type TaskWithContact,
} from '@/hooks/use-tasks'

type Gran = 'week' | 'month'

const METRICS: { key: string; label: string; dateOf: (m: DashMatch) => string | null }[] = [
  { key: 'inquiry', label: 'Inquiries', dateOf: (m) => m.inquiry_date },
  { key: 'tour', label: 'Tours', dateOf: (m) => m.tour_date },
  { key: 'loi', label: 'LOIs', dateOf: (m) => m.loi_date },
  { key: 'leaseneg', label: 'Lease neg.', dateOf: (m) => m.lease_negotiation_date },
  { key: 'exec', label: 'Executions', dateOf: (m) => m.execution_date },
]

function periodStarts(gran: Gran): Date[] {
  if (gran === 'week') {
    const cur = startOfWeek(new Date(), { weekStartsOn: 1 })
    return Array.from({ length: 8 }, (_, i) => subWeeks(cur, 7 - i))
  }
  const cur = startOfMonth(new Date())
  return Array.from({ length: 6 }, (_, i) => subMonths(cur, 5 - i))
}

function inPeriod(date: Date, start: Date, gran: Gran): boolean {
  return gran === 'week' ? isSameWeek(date, start, { weekStartsOn: 1 }) : isSameMonth(date, start)
}

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
      if (m.stage !== 'dead' && m.stage !== 'executed') active++
      if (m.flagged_new) flagged++
      if (m.execution_date) {
        const ed = parseISO(m.execution_date)
        if (ed >= d90) exec90++
        if (ed >= ytdStart) commissionYtd += matchFee(m)
      }
    }
    return { active, exec90, commissionYtd, flagged }
  }, [matches])

  const { periods, rows, commission } = useMemo(() => {
    const periods = periodStarts(gran)
    const rows = METRICS.map((metric) => ({
      label: metric.label,
      counts: periods.map((p) =>
        matches.reduce((n, m) => {
          const d = metric.dateOf(m)
          return d && inPeriod(parseISO(d), p, gran) ? n + 1 : n
        }, 0),
      ),
    }))
    const commission = periods.map((p) =>
      matches.reduce(
        (sum, m) =>
          m.execution_date && inPeriod(parseISO(m.execution_date), p, gran)
            ? sum + matchFee(m)
            : sum,
        0,
      ),
    )
    return { periods, rows, commission }
  }, [matches, gran])

  const label = (p: Date) => (gran === 'week' ? format(p, 'MMM d') : format(p, 'MMM'))

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Active deals" value={String(stats.active)} />
        <StatCard label="Executed (90d)" value={String(stats.exec90)} />
        <StatCard label="Commission (YTD)" value={formatCurrency(stats.commissionYtd) ?? '$0'} />
        <StatCard label="New matches" value={String(stats.flagged)} />
      </div>

      <div className="rounded-lg border bg-card">
        <div className="flex items-center justify-between border-b p-3">
          <h2 className="text-sm font-medium">Activity</h2>
          <div className="flex gap-1 rounded-md bg-muted p-0.5 text-xs">
            {(['week', 'month'] as Gran[]).map((g) => (
              <button
                key={g}
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
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="px-3 py-2 text-left font-medium">Metric</th>
                {periods.map((p, i) => (
                  <th key={i} className="px-3 py-2 text-right font-medium tabular-nums">
                    {label(p)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label} className="border-b last:border-0">
                  <td className="px-3 py-2 text-muted-foreground">{row.label}</td>
                  {row.counts.map((c, i) => (
                    <td
                      key={i}
                      className={cn(
                        'px-3 py-2 text-right tabular-nums',
                        c === 0 && 'text-muted-foreground/40',
                      )}
                    >
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="bg-muted/40 font-medium">
                <td className="px-3 py-2">Commission</td>
                {commission.map((c, i) => (
                  <td
                    key={i}
                    className={cn(
                      'px-3 py-2 text-right tabular-nums',
                      c === 0 && 'font-normal text-muted-foreground/40',
                    )}
                  >
                    {c > 0 ? formatCurrency(c) : '—'}
                  </td>
                ))}
              </tr>
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
                  to={m.property ? `/properties/${m.property.id}` : '#'}
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

function TaskRow({ task, tone }: { task: TaskWithContact; tone: 'overdue' | 'today' }) {
  const navigate = useNavigate()
  const toggle = useToggleTask()
  const path = taskDealPath(task)
  const who = task.contact ? contactNameOf(task.contact) : null
  return (
    <li
      className={cn(
        'flex items-center gap-2.5 px-3 py-2',
        tone === 'overdue' ? 'bg-red-50/60' : 'bg-amber-50/50',
      )}
    >
      <Checkbox
        checked={task.status === 'done'}
        onCheckedChange={(v) => toggle.mutate({ id: task.id, status: v === true ? 'done' : 'open' })}
        aria-label="Mark task done"
      />
      <button
        type="button"
        onClick={() => path && navigate(path)}
        disabled={!path}
        className="min-w-0 flex-1 text-left disabled:cursor-default"
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
          tone === 'overdue' ? 'text-red-700' : 'text-amber-700',
        )}
      >
        {task.due_date ? formatDate(task.due_date) : ''}
      </span>
    </li>
  )
}

/** Tasks that are overdue or due today — surfaced on the dashboard so nothing slips. */
export function TasksDueWidget() {
  const { data: tasks = [] } = useTasks()

  const { overdue, dueToday } = useMemo(() => {
    const today = format(new Date(), 'yyyy-MM-dd')
    const open = tasks.filter((t) => t.status === 'open' && t.due_date)
    return {
      overdue: open.filter((t) => (t.due_date as string) < today),
      dueToday: open.filter((t) => t.due_date === today),
    }
  }, [tasks])

  if (overdue.length === 0 && dueToday.length === 0) return null

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b p-3">
        <h2 className="text-sm font-medium">Tasks due</h2>
        <Link to="/tasks" className="text-xs text-primary hover:underline">
          View all
        </Link>
      </div>
      {overdue.length > 0 && (
        <div>
          <div className="bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700">
            Overdue · {overdue.length}
          </div>
          <ul className="divide-y">
            {overdue.map((t) => (
              <TaskRow key={t.id} task={t} tone="overdue" />
            ))}
          </ul>
        </div>
      )}
      {dueToday.length > 0 && (
        <div>
          <div className="bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700">
            Due today · {dueToday.length}
          </div>
          <ul className="divide-y">
            {dueToday.map((t) => (
              <TaskRow key={t.id} task={t} tone="today" />
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
