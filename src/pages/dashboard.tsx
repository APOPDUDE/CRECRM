import { useDashboardMatches } from '@/hooks/use-dashboard'
import { MarketAlertsWidget } from '@/components/market-alerts-widget'
import { DashboardActivity, TasksDueWidget } from '@/components/dashboard-activity'
import { DealFlagsWidget } from '@/components/deal-flags-widget'
import { NewListingsWidget } from '@/components/new-listings-widget'
import { FacebookListingsWidget } from '@/components/facebook-listings-widget'
import { OffMarketWidget } from '@/components/off-market-widget'
import { LeaseExpirationsWidget } from '@/components/lease-expirations-widget'
import { CountyAverages } from '@/components/county-averages'

export function DashboardPage() {
  const { data: dashMatches = [] } = useDashboardMatches()

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Dashboard</h1>

      <MarketAlertsWidget />

      <DealFlagsWidget />

      <NewListingsWidget />

      <FacebookListingsWidget />

      <OffMarketWidget />

      <LeaseExpirationsWidget />

      <DashboardActivity matches={dashMatches} />

      <TasksDueWidget />

      <CountyAverages />
    </div>
  )
}
