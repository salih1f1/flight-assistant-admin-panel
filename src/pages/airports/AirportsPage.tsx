import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { type ColumnDef } from '@tanstack/react-table'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { DataTable } from '@/components/DataTable'
import { ConfirmDeleteDialog } from '@/components/ConfirmDeleteDialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useAirports, useDeleteAirport } from '@/hooks/useAirports'
import type { Airport } from '@/types'

const PAGE_SIZE = 50

export function AirportsPage() {
  const [page, setPage] = useState(1)
  const { data, isLoading } = useAirports(page, PAGE_SIZE)
  const deleteMutation = useDeleteAirport()
  const navigate = useNavigate()
  const [deleteId, setDeleteId] = useState<number | null>(null)

  const columns: ColumnDef<Airport>[] = [
    { accessorKey: 'iata', header: 'IATA', cell: ({ row }) => <Badge variant="outline">{row.original.iata}</Badge> },
    { accessorKey: 'icao', header: 'ICAO', cell: ({ row }) => row.original.icao ?? '—' },
    { accessorKey: 'name', header: 'Name' },
    { accessorKey: 'city', header: 'City' },
    { accessorKey: 'countryCode', header: 'Country' },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex gap-2 justify-end">
          <Button size="sm" variant="ghost" onClick={() => navigate(`/airports/${row.original.id}/edit`)}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-700" onClick={() => setDeleteId(row.original.id)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ]

  if (isLoading) return <p className="text-gray-400">Loading…</p>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Airports</h1>
        <Button onClick={() => navigate('/airports/new')}>
          <Plus className="h-4 w-4 mr-2" /> Add airport
        </Button>
      </div>
      {/* No search box: the API has no search parameter, so it could only filter
          the rows on the current page. */}
      <DataTable
        columns={columns}
        data={data?.items ?? []}
        pagination={{ page, pageSize: PAGE_SIZE, total: data?.total ?? 0, onPageChange: setPage }}
      />
      <ConfirmDeleteDialog
        open={!!deleteId}
        onOpenChange={open => !open && setDeleteId(null)}
        title="Delete airport"
        description="This will permanently delete this airport record."
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteId != null) deleteMutation.mutate(deleteId, { onSuccess: () => setDeleteId(null) })
        }}
      />
    </div>
  )
}
