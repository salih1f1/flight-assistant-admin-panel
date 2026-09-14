import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { keepPreviousData, useQueryClient } from '@tanstack/react-query'
import { type ColumnDef } from '@tanstack/react-table'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { DataTable } from '@/components/DataTable'
import { ConfirmDeleteDialog } from '@/components/ConfirmDeleteDialog'
import { ViewTabs } from '@/components/ViewTabs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useAdminDeleteAirport, useAdminGetAllAirports } from '@/api/generated/admin'
import type { AirportAdminDto } from '@/api/generated/model'
import { invalidateAirports } from '@/api/cache'

const PAGE_SIZE = 50

export function AirportsPage() {
  const [page, setPage] = useState(1)
  const queryClient = useQueryClient()
  const { data, isLoading, error } = useAdminGetAllAirports(
    { Page: page, PageSize: PAGE_SIZE },
    { query: { placeholderData: keepPreviousData } },
  )
  const deleteMutation = useAdminDeleteAirport({ mutation: { onSuccess: () => invalidateAirports(queryClient) } })
  const navigate = useNavigate()
  const [deleteId, setDeleteId] = useState<number | null>(null)

  const columns: ColumnDef<AirportAdminDto>[] = [
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
          <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-700" onClick={() => setDeleteId(row.original.id ?? null)}>
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
      <ViewTabs table="airports" />
      {/* No search box: the API has no search parameter, so it could only filter
          the rows on the current page. */}
      <DataTable
        columns={columns}
        data={data?.items ?? []}
        error={error}
        pagination={{ page, pageSize: PAGE_SIZE, total: data?.total ?? 0, onPageChange: setPage }}
      />
      <ConfirmDeleteDialog
        open={!!deleteId}
        onOpenChange={open => !open && setDeleteId(null)}
        title="Delete airport"
        description="This will permanently delete this airport record."
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteId != null) deleteMutation.mutate({ id: deleteId }, { onSuccess: () => setDeleteId(null) })
        }}
      />
    </div>
  )
}
