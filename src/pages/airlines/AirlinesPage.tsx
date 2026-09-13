import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { type ColumnDef } from '@tanstack/react-table'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { DataTable } from '@/components/DataTable'
import { ConfirmDeleteDialog } from '@/components/ConfirmDeleteDialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useAirlines, useDeleteAirline } from '@/hooks/useAirlines'
import type { Airline } from '@/types'

const PAGE_SIZE = 50

export function AirlinesPage() {
  const [page, setPage] = useState(1)
  const { data, isLoading } = useAirlines(page, PAGE_SIZE)
  const deleteMutation = useDeleteAirline()
  const navigate = useNavigate()
  const [deleteId, setDeleteId] = useState<number | null>(null)

  const columns: ColumnDef<Airline>[] = [
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
        <h1 className="text-2xl font-bold text-gray-900">Airlines</h1>
        <Button onClick={() => navigate('/airlines/new')}>
          <Plus className="h-4 w-4 mr-2" /> Add airline
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
        title="Delete airline"
        description="Cannot delete if flights reference this airline."
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteId != null) deleteMutation.mutate(deleteId, { onSuccess: () => setDeleteId(null) })
        }}
      />
    </div>
  )
}
