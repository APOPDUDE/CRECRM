import { useDashboardMatches } from '@/hooks/use-dashboard'
import { DashboardActivity, TasksDueWidget } from '@/components/dashboard-activity'
import { NewListingsWidget } from '@/components/new-listings-widget'
import { OffMarketWidget } from '@/components/off-market-widget'
import { CountyAverages } from '@/components/county-averages'

export function DashboardPage() {
  const { data: dashMatches = [] } = useDashboardMatches()

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Dashboard</h1>

      <NewListingsWidget />

      <OffMarketWidget />

      <DashboardActivity matches={dashMatches} />

      <TasksDueWidget />

      <CountyAverages />
    </div>
  )
}
