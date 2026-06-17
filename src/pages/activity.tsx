import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { formatCurrency } from '@/lib/format'
import { useDashboardMatches } from '@/hooks/use-dashboard'
import { activityRows, periodsSince, METRIC_LABELS, type Gran } from '@/lib/activity'
import { useSetBreadcrumb } from '@/hooks/use-breadcrumb'

/** Full activity history — every week (or month) back to the earliest dated deal. */
export function ActivityPage() {
  const navigate = useNavigate()
  const { data: matches = [], isLoading } = useDashboardMatches()
  const [gran, setGran] = useState<Gran>('week')
  useSetBreadcrumb('Activity')

  const data = useMemo(() => activityRows(matches, periodsSince(matches, gran), gran), [matches, gran])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="size-8" onClick={() => navigate(-1)}>
            <ArrowLeft className="size-4" />
            <span className="sr-only">Back</span>
          </Button>
          <h1 className="text-xl font-semibold">Activity</h1>
        </div>
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

      {isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
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
      )}
    </div>
  )
}
