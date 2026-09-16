import { AeroApiUsageSection } from './dashboard/AeroApiUsageSection'
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
    </div>
  )
}
