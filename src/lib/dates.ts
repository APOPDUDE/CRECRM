import { differenceInCalendarDays, format, parseISO } from 'date-fns'

/** A next-action date is overdue if it's strictly before today. */
export function isOverdue(date: string | null | undefined): boolean {
  if (!date) return false
  return date < format(new Date(), 'yyyy-MM-dd')
}

/** "today", "3 days", "12 days" — for a date in the past. */
export function daysAgoLabel(date: string | null | undefined): string | null {
  if (!date) return null
  const days = differenceInCalendarDays(new Date(), parseISO(date))
  if (days <= 0) return 'today'
  if (days === 1) return '1 day'
  return `${days} days`
}

/** Human date like "Jun 12, 2026". */
export function formatDate(date: string | null | undefined): string | null {
  if (!date) return null
  return format(parseISO(date), 'MMM d, yyyy')
}

/**
 * "2:30 PM" from either a Postgres time ("14:30:00", wall-clock) or an ISO
 * timestamp ("…T18:30:00Z", rendered in the viewer's local timezone).
 */
export function formatTimeOfDay(value: string | null | undefined): string | null {
  if (!value) return null
  let h: number
  let m: number
  if (value.includes('T')) {
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return null
    h = d.getHours()
    m = d.getMinutes()
  } else {
    const [hStr, mStr] = value.split(':')
    h = Number(hStr)
    m = Number(mStr)
  }
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}
