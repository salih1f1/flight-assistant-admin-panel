import { useState } from 'react'
import { type ColumnDef } from '@tanstack/react-table'
import { Trash2, RefreshCw } from 'lucide-react'
import { DataTable } from '@/components/DataTable'
import { ConfirmDeleteDialog } from '@/components/ConfirmDeleteDialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useFlights, useDeleteFlight, useSyncFlight } from '@/hooks/useFlights'
import type { AdminFlight } from '@/types'

const PAGE_SIZE = 50

export function FlightsPage() {
  const [page, setPage] = useState(1)
  const { data, isLoading } = useFlights(page, PAGE_SIZE)
  const deleteMutation = useDeleteFlight()
  const syncMutation = useSyncFlight()
  const [deleteId, setDeleteId] = useState<number | null>(null)

  const columns: ColumnDef<AdminFlight>[] = [
    { accessorKey: 'flightNumber', header: 'Flight #' },
    { accessorKey: 'serviceDate', header: 'Date', cell: ({ row }) => row.original.serviceDate },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const f = row.original
        if (f.actualDepartureUtc) return <Badge variant="secondary">Departed</Badge>
        if (f.estimatedDepartureUtc) return <Badge>Estimated</Badge>
        return <Badge variant="outline">Scheduled</Badge>
      },
    },
    {
      id: 'departure',
      header: 'Departure',
      cell: ({ row }) => new Date(row.original.scheduledDepartureUtc).toLocaleString(),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex gap-2 justify-end">
          <Button
            size="sm" variant="ghost"
            onClick={() => syncMutation.mutate(row.original.id)}
            disabled={syncMutation.isPending}
            title="Sync status"
          >
            <RefreshCw className="h-4 w-4" />
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
      <h1 className="text-2xl font-bold text-gray-900">Flights</h1>
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
        title="Delete flight"
        description="This will remove the flight record and all tracking links."
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteId != null) deleteMutation.mutate(deleteId, { onSuccess: () => setDeleteId(null) })
        }}
      />
    </div>
  )
}
