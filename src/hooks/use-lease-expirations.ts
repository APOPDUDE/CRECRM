import { useQuery } from '@tanstack/react-query'
import { addMonths, startOfMonth } from 'date-fns'
import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

export type LeaseExpiration = Database['public']['Views']['v_lease_expirations']['Row']

const PAGE = 1000

/**
 * Every executed lease that knows when it ends, parcel attached.
 *
 * Fetched whole (~1.3k rows) rather than filtered server-side: both consumers slice the
 * same set on different windows -- the dashboard graph on the next twelve months, the
 * War Room on whatever min/max the broker types -- and a server round-trip per slice
 * would refetch on every keystroke of the filter.
 */
export function useLeaseExpirations() {
  return useQuery({
    queryKey: ['lease-expirations'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      // count:'exact' on the first page only; repeating it per page just multiplies work.
      const base = (withCount?: boolean) =>
        supabase
          .from('v_lease_expirations')
          .select('*', withCount ? { count: 'exact' } : undefined)
          // (expiration_date, comp_id) — the id tiebreaks so offset pages stay stable.
          .order('expiration_date')
          .order('comp_id')
      const first = await base(true).range(0, PAGE - 1)
      if (first.error) throw first.error
      const total = first.count ?? first.data?.length ?? 0
      const rest = await Promise.all(
        Array.from({ length: Math.max(0, Math.ceil(total / PAGE) - 1) }, (_, i) =>
          base().range((i + 1) * PAGE, (i + 2) * PAGE - 1),
        ),
      )
      const all = [...(first.data ?? [])]
      for (const r of rest) {
        if (r.error) throw r.error
        all.push(...(r.data ?? []))
      }
      return all
    },
  })
}

/**
 * Window test in calendar months, not month arithmetic on a signed integer.
 *
 * `months_to_expiry` is floored, so a lease 40 days out and one 75 days out both live
 * in "1" — fine for a label, wrong for a boundary, because "max 3 months" has to mean
 * "on or before the same day three months from now". Comparing dates keeps month
 * lengths honest and makes the min/max inclusive in the way a broker reads them.
 */
export function withinMonths(
  row: Pick<LeaseExpiration, 'expiration_date'>,
  min: number | null,
  max: number | null,
): boolean {
  if (!row.expiration_date) return false
  const exp = new Date(`${row.expiration_date}T00:00:00`)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  if (min != null && exp < addMonths(today, min)) return false
  if (max != null && exp > addMonths(today, max)) return false
  return true
}

export interface ExpiryMonthBucket {
  /** First of the month, for labelling and for the drill-through range. */
  date: Date
  label: string
  count: number
  sf: number
}

/**
 * Lease count per calendar month for the next `months` months, starting this month.
 * Empty months are kept — a gap in the run-off is information, and dropping them would
 * make the bars lie about spacing.
 */
export function bucketByMonth(rows: LeaseExpiration[], months: number): ExpiryMonthBucket[] {
  const start = startOfMonth(new Date())
  const buckets: ExpiryMonthBucket[] = Array.from({ length: months }, (_, i) => {
    const date = addMonths(start, i)
    return {
      date,
      label: date.toLocaleDateString(undefined, { month: 'short' }),
      count: 0,
      sf: 0,
    }
  })
  const index = new Map(buckets.map((b, i) => [`${b.date.getFullYear()}-${b.date.getMonth()}`, i]))
  for (const r of rows) {
    if (!r.expiration_date) continue
    const exp = new Date(`${r.expiration_date}T00:00:00`)
    const hit = index.get(`${exp.getFullYear()}-${exp.getMonth()}`)
    if (hit == null) continue
    buckets[hit].count += 1
    buckets[hit].sf += r.sf ?? 0
  }
  return buckets
}
