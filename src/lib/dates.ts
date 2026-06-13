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
