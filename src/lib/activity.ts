import {
  format,
  isSameDay,
  isSameMonth,
  isSameWeek,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
  subWeeks,
} from 'date-fns'
import { matchFee, type DailyCounts, type DashMatch } from '@/hooks/use-dashboard'

export type Gran = 'day' | 'week' | 'month'

export const GRAN_LABELS: Record<Gran, string> = { day: 'Daily', week: 'Weekly', month: 'Monthly' }

/** Column order of `ActivityRow.metrics`. */
export const METRIC_LABELS = [
  'Inquiries',
  'Tours',
  'Executions',
  'Verified owners',
  'Buyers',
  'Conversations',
] as const

/** What each column counts — the header tooltip. */
export const METRIC_HINTS: Record<(typeof METRIC_LABELS)[number], string> = {
  Inquiries: 'Pursuits by inquiry date',
  Tours: 'Pursuits by tour date',
  Executions: 'Pursuits by executed date',
  'Verified owners': 'Property owners a human reached (verified), by the day they were verified',
  Buyers: 'People who became buyers — a buyer tag or a buyer client, whichever came first',
  Conversations: 'People touched by a call, text, email, note or meeting that day',
}

const DATE_OF: ((m: DashMatch) => string | null)[] = [
  (m) => m.inquiry_date,
  (m) => m.tour_date,
  (m) => m.executed_date,
]

/** Daily-count columns, aligned to METRIC_LABELS[3..]. */
const DAILY_OF: ((d: DailyCounts) => number)[] = [
  (d) => d.verified_owners,
  (d) => d.buyers,
  (d) => d.conversations,
]

/** How far back the daily view reaches on the full Activity page. */
export const DAILY_HISTORY_DAYS = 90

export function inPeriod(date: Date, start: Date, gran: Gran): boolean {
  if (gran === 'day') return isSameDay(date, start)
  return gran === 'week' ? isSameWeek(date, start, { weekStartsOn: 1 }) : isSameMonth(date, start)
}

export function periodLabel(p: Date, gran: Gran): string {
  if (gran === 'day') return format(p, 'EEE MMM d')
  return gran === 'week' ? format(p, 'MMM d') : format(p, 'MMM yyyy')
}

function periodStart(d: Date, gran: Gran): Date {
  if (gran === 'day') return startOfDay(d)
  return gran === 'week' ? startOfWeek(d, { weekStartsOn: 1 }) : startOfMonth(d)
}

function prevPeriod(p: Date, gran: Gran): Date {
  if (gran === 'day') return subDays(p, 1)
  return gran === 'week' ? subWeeks(p, 1) : subMonths(p, 1)
}

/** The `count` most-recent period starts, current first. */
export function recentPeriods(gran: Gran, count: number): Date[] {
  const cur = periodStart(new Date(), gran)
  const out: Date[] = []
  for (let p = cur, i = 0; i < count; p = prevPeriod(p, gran), i++) out.push(p)
  return out
}

/**
 * Every period start from the earliest dated match or daily counter through now, current
 * first. Days are capped at DAILY_HISTORY_DAYS — a year of one-row-per-day is a scroll, not
 * a report.
 */
export function periodsSince(matches: DashMatch[], daily: DailyCounts[], gran: Gran): Date[] {
  let earliest = new Date()
  for (const m of matches) {
    const dates = [...DATE_OF.map((f) => f(m)), m.created_at]
    for (const d of dates) {
      if (d) {
        const dt = parseISO(d)
        if (dt < earliest) earliest = dt
      }
    }
  }
  for (const d of daily) {
    const dt = parseISO(d.day)
    if (dt < earliest) earliest = dt
  }
  if (gran === 'day') {
    const cap = subDays(new Date(), DAILY_HISTORY_DAYS - 1)
    if (earliest < cap) earliest = cap
  }
  const cur = periodStart(new Date(), gran)
  const floor = periodStart(earliest, gran)
  const out: Date[] = []
  for (let p = cur; p >= floor; p = prevPeriod(p, gran)) out.push(p)
  return out
}

export interface ActivityRow {
  label: string
  isCurrent: boolean
  /** aligned to METRIC_LABELS */
  metrics: number[]
  /** per-cell tooltip, aligned to METRIC_LABELS (only Conversations has one today) */
  hints: (string | undefined)[]
  commission: number
}

function conversationHint(d: Pick<DailyCounts, 'calls' | 'texts' | 'emails' | 'notes'>): string | undefined {
  const parts = [
    [d.calls, 'call', 'calls'],
    [d.texts, 'text', 'texts'],
    [d.emails, 'email', 'emails'],
    [d.notes, 'note', 'notes'],
  ] as const
  const out = parts.filter(([n]) => n > 0).map(([n, one, many]) => `${n} ${n === 1 ? one : many}`)
  return out.length ? out.join(' · ') : undefined
}

/**
 * Per-period counts aligned to METRIC_LABELS (pursuit dates from `matches`, the rest summed
 * from the daily counters) plus executed commission.
 */
export function activityRows(
  matches: DashMatch[],
  daily: DailyCounts[],
  periods: Date[],
  gran: Gran,
): ActivityRow[] {
  const now = new Date()
  return periods.map((p) => {
    const days = daily.filter((d) => inPeriod(parseISO(d.day), p, gran))
    const sums = { calls: 0, texts: 0, emails: 0, notes: 0 }
    for (const d of days) {
      sums.calls += d.calls
      sums.texts += d.texts
      sums.emails += d.emails
      sums.notes += d.notes
    }
    const metrics = [
      ...DATE_OF.map((f) =>
        matches.reduce((n, m) => {
          const d = f(m)
          return d && inPeriod(parseISO(d), p, gran) ? n + 1 : n
        }, 0),
      ),
      ...DAILY_OF.map((f) => days.reduce((n, d) => n + f(d), 0)),
    ]
    const hints: (string | undefined)[] = METRIC_LABELS.map(() => undefined)
    hints[METRIC_LABELS.indexOf('Conversations')] = conversationHint(sums)
    return {
      label: periodLabel(p, gran),
      isCurrent: inPeriod(now, p, gran),
      metrics,
      hints,
      commission: matches.reduce(
        (s, m) =>
          m.executed_date && inPeriod(parseISO(m.executed_date), p, gran) ? s + matchFee(m) : s,
        0,
      ),
    }
  })
}
