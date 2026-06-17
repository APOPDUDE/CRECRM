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
import { matchFee, type DashMatch } from '@/hooks/use-dashboard'

export type Gran = 'week' | 'month'

export const METRIC_LABELS = ['Inquiries', 'Tours', 'Executions'] as const

const DATE_OF: ((m: DashMatch) => string | null)[] = [
  (m) => m.inquiry_date,
  (m) => m.tour_date,
  (m) => m.executed_date,
]

export function inPeriod(date: Date, start: Date, gran: Gran): boolean {
  return gran === 'week' ? isSameWeek(date, start, { weekStartsOn: 1 }) : isSameMonth(date, start)
}

export function periodLabel(p: Date, gran: Gran): string {
  return gran === 'week' ? format(p, 'MMM d') : format(p, 'MMM yyyy')
}

/** The `count` most-recent period starts, current first. */
export function recentPeriods(gran: Gran, count: number): Date[] {
  const cur = gran === 'week' ? startOfWeek(new Date(), { weekStartsOn: 1 }) : startOfMonth(new Date())
  return Array.from({ length: count }, (_, i) => (gran === 'week' ? subWeeks(cur, i) : subMonths(cur, i)))
}

/** Every period start from the earliest dated match through now, current first. */
export function periodsSince(matches: DashMatch[], gran: Gran): Date[] {
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
  const cur = gran === 'week' ? startOfWeek(new Date(), { weekStartsOn: 1 }) : startOfMonth(new Date())
  const floor = gran === 'week' ? startOfWeek(earliest, { weekStartsOn: 1 }) : startOfMonth(earliest)
  const out: Date[] = []
  for (let p = cur; p >= floor; p = gran === 'week' ? subWeeks(p, 1) : subMonths(p, 1)) out.push(p)
  return out
}

export interface ActivityRow {
  label: string
  isCurrent: boolean
  metrics: number[]
  commission: number
}

/** Per-period counts (inquiries/tours/executions) + commission, aligned to METRIC_LABELS. */
export function activityRows(matches: DashMatch[], periods: Date[], gran: Gran): ActivityRow[] {
  const now = new Date()
  return periods.map((p) => ({
    label: periodLabel(p, gran),
    isCurrent: inPeriod(now, p, gran),
    metrics: DATE_OF.map((f) =>
      matches.reduce((n, m) => {
        const d = f(m)
        return d && inPeriod(parseISO(d), p, gran) ? n + 1 : n
      }, 0),
    ),
    commission: matches.reduce(
      (s, m) => (m.executed_date && inPeriod(parseISO(m.executed_date), p, gran) ? s + matchFee(m) : s),
      0,
    ),
  }))
}
