import { useQuery } from '@tanstack/react-query'
import { addMonths, startOfMonth, subMonths } from 'date-fns'
import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

export type LeaseComp = Database['public']['Views']['v_lease_comps']['Row']

const PAGE = 1000

/**
 * Every executed lease comp, expired ones included, parcel attached.
 *
 * Fetched whole (~1.3k rows) rather than filtered server-side: the consumers slice the
 * same set on different windows -- the dashboard graph on the next twelve months, the
 * War Room on whatever expiry or sign-date range the broker types -- and a server
 * round-trip per slice would refetch on every keystroke of the filter.
 */
export function useLeaseComps(enabled = true) {
  return useQuery({
    queryKey: ['lease-comps'],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      // count:'exact' on the first page only; repeating it per page just multiplies work.
      const base = (withCount?: boolean) =>
        supabase
          .from('v_lease_comps')
          .select('*', withCount ? { count: 'exact' } : undefined)
          // (expiration_date, comp_id) — the id tiebreaks so offset pages stay stable.
          .order('expiration_date', { nullsFirst: false })
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
 * Window tests in calendar months, not arithmetic on the floored month integers.
 *
 * `months_to_expiry` / `months_since_signed` are floored, so a lease 40 days out and one
 * 75 days out both live in "1" — fine for a label, wrong for a boundary, because "max 3
 * months" has to mean "on or before the same day three months from now". Comparing dates
 * keeps month lengths honest and makes min/max inclusive the way a broker reads them.
 */
function inDateWindow(
  value: string | null,
  earliest: Date | null,
  latest: Date | null,
): boolean {
  if (!value) return false
  const d = new Date(`${value}T00:00:00`)
  if (earliest && d < earliest) return false
  if (latest && d > latest) return false
  return true
}

const today = () => {
  const t = new Date()
  t.setHours(0, 0, 0, 0)
  return t
}

/** Leases expiring between `min` and `max` months from now. Forward-looking. */
export function withinMonths(
  row: Pick<LeaseComp, 'expiration_date'>,
  min: number | null,
  max: number | null,
): boolean {
  const t = today()
  return inDateWindow(
    row.expiration_date,
    min == null ? null : addMonths(t, min),
    max == null ? null : addMonths(t, max),
  )
}

/**
 * Leases signed between `min` and `max` months ago. The mirror of withinMonths: here the
 * larger number is the older bound, so "signed in the last 12 months" is min 0, max 12.
 */
export function signedWithinMonths(
  row: Pick<LeaseComp, 'signed_date'>,
  min: number | null,
  max: number | null,
): boolean {
  const t = today()
  return inDateWindow(
    row.signed_date,
    max == null ? null : subMonths(t, max),
    min == null ? null : subMonths(t, min),
  )
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
export function bucketByMonth(rows: LeaseComp[], months: number): ExpiryMonthBucket[] {
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
