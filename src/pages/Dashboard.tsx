import { AeroApiUsageSection } from './dashboard/AeroApiUsageSection'
import { AzureSpendSection } from './dashboard/AzureSpendSection'
import { NeedsAttentionSection } from './dashboard/NeedsAttentionSection'
import { RecentActivitySection } from './dashboard/RecentActivitySection'
import { StatsSection } from './dashboard/StatsSection'
import { SystemHealthSection } from './dashboard/SystemHealthSection'

export function Dashboard() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
      <StatsSection />
      <RecentActivitySection />
      <NeedsAttentionSection />
      <SystemHealthSection />
      <AeroApiUsageSection />
      {/* Directly below: both answer "what is this costing", and someone checking spend wants
          them in one glance. */}
      <AzureSpendSection />
    </div>
  )
}
