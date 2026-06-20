import { useDashboardMatches } from '@/hooks/use-dashboard'
import { DashboardActivity, TasksDueWidget } from '@/components/dashboard-activity'
import { SuggestionsWidget } from '@/components/suggestions-widget'
import { OffMarketWidget } from '@/components/off-market-widget'
import { CountyAverages } from '@/components/county-averages'

export function DashboardPage() {
  const { data: dashMatches = [] } = useDashboardMatches()

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Dashboard</h1>

      <SuggestionsWidget />

      <DashboardActivity matches={dashMatches} />

      <OffMarketWidget />

      <TasksDueWidget />

      <CountyAverages />
    </div>
  )
}
