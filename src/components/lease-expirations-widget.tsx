import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { addMonths, format } from 'date-fns'
import { CalendarClock, ChevronDown, ChevronRight } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import {
  bucketByMonth,
  useLeaseComps,
  withinMonths,
  type ExpiryMonthBucket,
} from '@/hooks/use-lease-comps'
import { formatSf } from '@/lib/format'

/** The windows a broker actually plans against. */
const WINDOWS: { months: number; label: string }[] = [
  { months: 1, label: '1 month' },
  { months: 3, label: '3 months' },
  { months: 6, label: '6 months' },
  { months: 12, label: '1 year' },
]

const CHART_MONTHS = 12

/**
 * Run-off over the next year, one bar per calendar month.
 *
 * Single series, so no legend — the heading names it. Every bar carries its own count,
 * which makes a y-axis and gridlines redundant furniture; the baseline alone is enough.
 * Bars are the drill-through: clicking one opens that month on the War Room lease map.
 */
function ExpiryBars({
  buckets,
  onPick,
}: {
  buckets: ExpiryMonthBucket[]
  onPick: (b: ExpiryMonthBucket) => void
}) {
  const W = 640
  const H = 150
  const m = { top: 20, right: 8, bottom: 26, left: 8 }
  const pw = W - m.left - m.right
  const ph = H - m.top - m.bottom
  const max = Math.max(1, ...buckets.map((b) => b.count))
  const slot = pw / buckets.length
  // 2px of surface either side keeps neighbouring bars from fusing into one block.
  const barW = Math.max(6, slot - 10)

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label={`Leases expiring per month for the next ${buckets.length} months`}
    >
      {buckets.map((b, i) => {
        const h = b.count === 0 ? 0 : Math.max(3, (b.count / max) * ph)
        const x = m.left + i * slot + (slot - barW) / 2
        const y = m.top + (ph - h)
        // January earns its year; every other month is unambiguous at this range.
        const label = b.date.getMonth() === 0 || i === 0 ? format(b.date, 'MMM yy') : b.label
        return (
          <g
            key={b.date.toISOString()}
            className={cn(b.count > 0 && 'cursor-pointer')}
            onClick={() => b.count > 0 && onPick(b)}
            role={b.count > 0 ? 'button' : undefined}
            tabIndex={b.count > 0 ? 0 : undefined}
            onKeyDown={(e) => {
              if (b.count > 0 && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault()
                onPick(b)
              }
            }}
          >
            <title>
              {format(b.date, 'MMMM yyyy')}: {b.count} {b.count === 1 ? 'lease' : 'leases'}
              {b.sf > 0 ? ` · ${formatSf(b.sf)}` : ''}
            </title>
            {/* Full-height hit target — a 3px bar is not something you can click. */}
            <rect x={x} y={m.top} width={barW} height={ph} className="fill-transparent" />
            {b.count > 0 && (
              <>
                <rect x={x} y={y} width={barW} height={h} rx={4} className="fill-primary" />
                <text
                  x={x + barW / 2}
                  y={y - 6}
                  textAnchor="middle"
                  className="fill-muted-foreground"
                  fontSize={11}
                >
                  {b.count}
                </text>
              </>
            )}
            <text
              x={x + barW / 2}
              y={H - 8}
              textAnchor="middle"
              className="fill-muted-foreground"
              fontSize={11}
            >
              {label}
            </text>
          </g>
        )
      })}
      <line
        x1={m.left}
        x2={W - m.right}
        y1={m.top + ph}
        y2={m.top + ph}
        stroke="currentColor"
        className="text-border"
        strokeWidth={1}
      />
    </svg>
  )
}

/**
 * Leases coming off over the next year — the pipeline that already exists in the comp
 * book but had no way to be asked about. Every number here clicks through to the same
 * set on the War Room lease map.
 */
export function LeaseExpirationsWidget() {
  const navigate = useNavigate()
  const { data: rows = [], isLoading } = useLeaseComps()
  // Collapsed on every dashboard load. The run-off is a thing you go looking for, not
  // something that should be occupying the top of the page before you ask for it; the
  // header still carries the count, which is the part worth seeing at a glance.
  const [expanded, setExpanded] = useState(false)

  const { buckets, counts, upcoming } = useMemo(() => {
    const future = rows.filter((r) => (r.months_to_expiry ?? -1) >= 0)
    return {
      buckets: bucketByMonth(future, CHART_MONTHS),
      counts: WINDOWS.map((w) => rows.filter((r) => withinMonths(r, 0, w.months)).length),
      upcoming: future.length,
    }
  }, [rows])

  const openMap = (params: Record<string, string>) =>
    navigate(`/properties?${new URLSearchParams({ view: 'map', layer: 'lease', ...params })}`)

  if (isLoading) {
    return (
      <div className="rounded-lg border bg-card p-3">
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }
  if (rows.length === 0) return null

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 p-3 text-left hover:bg-accent/50"
      >
        {expanded ? (
          <ChevronDown className="size-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-4 text-muted-foreground" />
        )}
        <CalendarClock className="size-4 text-primary" />
        <h2 className="text-sm font-medium">Lease expirations</h2>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary tabular-nums">
          {upcoming}
        </span>
      </button>

      {expanded && (
        <div className="space-y-3 border-t p-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {WINDOWS.map((w, i) => (
              <button
                key={w.months}
                type="button"
                onClick={() => openMap({ expMax: String(w.months) })}
                className="rounded-md border p-2 text-left transition-colors hover:border-primary hover:bg-accent/50"
              >
                <div className="text-lg font-semibold tabular-nums">{counts[i]}</div>
                <div className="text-xs text-muted-foreground">within {w.label}</div>
              </button>
            ))}
          </div>

          <ExpiryBars
            buckets={buckets}
            onPick={(b) => openMap({ expMonth: format(b.date, 'yyyy-MM') })}
          />

          <p className="text-xs text-muted-foreground">
            Click a month or a card to map those leases.{' '}
            {formatSf(buckets.reduce((s, b) => s + b.sf, 0))} expiring through{' '}
            {format(addMonths(new Date(), CHART_MONTHS - 1), 'MMM yyyy')}.
          </p>
        </div>
      )}
    </div>
  )
}
