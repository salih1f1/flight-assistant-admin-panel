import { type ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/components/DataTable'
import { Badge } from '@/components/ui/badge'
import { useCountries } from '@/hooks/useRefData'
import type { Country } from '@/types'

export function CountriesPage() {
  const { data = [], isLoading } = useCountries()

  const columns: ColumnDef<Country>[] = [
    { accessorKey: 'code', header: 'Code', cell: ({ row }) => <Badge variant="outline">{row.original.code}</Badge> },
    { accessorKey: 'name', header: 'Name' },
    { accessorKey: 'alpha3', header: 'Alpha-3', cell: ({ row }) => row.original.alpha3 ?? '—' },
    { accessorKey: 'region', header: 'Region', cell: ({ row }) => row.original.region ?? '—' },
    {
      id: 'flags',
      header: 'Membership',
      cell: ({ row }) => (
        <div className="flex gap-1 flex-wrap">
          {row.original.isEU && <Badge variant="secondary">EU</Badge>}
          {row.original.isSchengen && <Badge variant="secondary">Schengen</Badge>}
          {row.original.isEEA && <Badge variant="secondary">EEA</Badge>}
        </div>
      ),
    },
  ]

  if (isLoading) return <p className="text-gray-400">Loading…</p>

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Countries</h1>
      <p className="text-sm text-gray-500">Read-only reference data seeded from OpenFlights.</p>
      <DataTable columns={columns} data={data} searchPlaceholder="Search countries…" searchColumn="name" />
    </div>
  )
}
