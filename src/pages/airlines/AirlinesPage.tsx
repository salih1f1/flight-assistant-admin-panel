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
import { useAdminDeleteAirline, useAdminGetAllAirlines } from '@/api/generated/admin'
import type { AirlineAdminDto } from '@/api/generated/model'
import { invalidateAirlines } from '@/api/cache'

const PAGE_SIZE = 50

export function AirlinesPage() {
  const [page, setPage] = useState(1)
  const queryClient = useQueryClient()
  const { data, isLoading, error } = useAdminGetAllAirlines(
    { Page: page, PageSize: PAGE_SIZE },
    // Keep the current page on screen while the next one loads, rather than
    // dropping back to the full-page loading state on every click.
    { query: { placeholderData: keepPreviousData } },
  )
  const deleteMutation = useAdminDeleteAirline({ mutation: { onSuccess: () => invalidateAirlines(queryClient) } })
  const navigate = useNavigate()
  const [deleteId, setDeleteId] = useState<number | null>(null)

  const columns: ColumnDef<AirlineAdminDto>[] = [
    { accessorKey: 'iata', header: 'IATA', cell: ({ row }) => row.original.iata ? <Badge variant="outline">{row.original.iata}</Badge> : '—' },
    { accessorKey: 'icao', header: 'ICAO', cell: ({ row }) => row.original.icao ?? '—' },
    { accessorKey: 'name', header: 'Name' },
    { accessorKey: 'countryCode', header: 'Country' },
    { accessorKey: 'allianceCode', header: 'Alliance', cell: ({ row }) => row.original.allianceCode ?? '—' },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex gap-2 justify-end">
          <Button size="sm" variant="ghost" onClick={() => navigate(`/airlines/${row.original.id}/edit`)}>
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
        <h1 className="text-2xl font-bold text-gray-900">Airlines</h1>
        <Button onClick={() => navigate('/airlines/new')}>
          <Plus className="h-4 w-4 mr-2" /> Add airline
        </Button>
      </div>
      <ViewTabs table="airlines" />
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
        title="Delete airline"
        description="Cannot delete if flights reference this airline."
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteId != null) deleteMutation.mutate({ id: deleteId }, { onSuccess: () => setDeleteId(null) })
        }}
      />
    </div>
  )
}
