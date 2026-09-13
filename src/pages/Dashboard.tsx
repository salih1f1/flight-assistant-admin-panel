import { Users, Plane, Building2, MapPin, Award, Sofa } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useTravelers } from '@/hooks/useTravelers'
import { useFlights } from '@/hooks/useFlights'
import { useAdminGetAllAirlines } from '@/api/generated/admin'
import { useAirports } from '@/hooks/useAirports'
import { useLoyaltyPrograms } from '@/hooks/useLoyalty'
import { useLounges } from '@/hooks/useLounges'

type Count = { count: number | undefined; isLoading: boolean }

const totalOf = ({ data, isLoading }: { data?: { total?: number }; isLoading: boolean }): Count => ({
  count: data?.total,
  isLoading,
})

// Only the totals are needed, so each tile asks for a single row.
const stats = [
  { label: 'Travelers', icon: Users, useCount: () => totalOf(useTravelers(1, 1)), color: 'text-blue-600' },
  { label: 'Flights', icon: Plane, useCount: () => totalOf(useFlights(1, 1)), color: 'text-green-600' },
  { label: 'Airlines', icon: Building2, useCount: () => totalOf(useAdminGetAllAirlines({ Page: 1, PageSize: 1 })), color: 'text-purple-600' },
  { label: 'Airports', icon: MapPin, useCount: () => totalOf(useAirports(1, 1)), color: 'text-orange-600' },
  { label: 'Loyalty Programs', icon: Award, useCount: () => totalOf(useLoyaltyPrograms(1, 1)), color: 'text-yellow-600' },
  { label: 'Lounges', icon: Sofa, useCount: () => totalOf(useLounges(1, 1)), color: 'text-pink-600' },
]

function StatCard({ label, icon: Icon, useCount, color }: (typeof stats)[0]) {
  const { count, isLoading } = useCount()
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-gray-500">{label}</CardTitle>
        <Icon className={`h-5 w-5 ${color}`} />
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-bold">
          {isLoading ? '—' : count ?? 0}
        </p>
      </CardContent>
    </Card>
  )
}

export function Dashboard() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map(s => <StatCard key={s.label} {...s} />)}
      </div>
    </div>
  )
}
