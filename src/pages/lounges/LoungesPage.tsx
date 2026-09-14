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
import { useAdminDeleteLounge, useAdminGetAllLounges } from '@/api/generated/admin'
import type { AdminLoungeDto } from '@/api/generated/model'
import { invalidateLounges } from '@/api/cache'

const PAGE_SIZE = 50

export function LoungesPage() {
  const [page, setPage] = useState(1)
  const queryClient = useQueryClient()
  const { data, isLoading, error } = useAdminGetAllLounges(
    { Page: page, PageSize: PAGE_SIZE },
    { query: { placeholderData: keepPreviousData } },
  )
  const deleteMutation = useAdminDeleteLounge({ mutation: { onSuccess: () => invalidateLounges(queryClient) } })
  const navigate = useNavigate()
  const [deleteId, setDeleteId] = useState<number | null>(null)

  const columns: ColumnDef<AdminLoungeDto>[] = [
    { accessorKey: 'name', header: 'Name' },
    { accessorKey: 'terminal', header: 'Terminal', cell: ({ row }) => row.original.terminal ?? '—' },
    {
      id: 'flags',
      header: 'Type',
      cell: ({ row }) => (
        <div className="flex gap-1">
          {row.original.isAirside && <Badge variant="secondary">Airside</Badge>}
          {row.original.isDomesticOnly && <Badge variant="outline">Domestic</Badge>}
          {row.original.isInternationalOnly && <Badge variant="outline">Intl</Badge>}
        </div>
      ),
    },
    { accessorKey: 'hours', header: 'Hours', cell: ({ row }) => row.original.hours ?? '—' },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex gap-2 justify-end">
          <Button size="sm" variant="ghost" onClick={() => navigate(`/lounges/${row.original.id}/edit`)}>
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
        <h1 className="text-2xl font-bold text-gray-900">Lounges</h1>
        <Button onClick={() => navigate('/lounges/new')}>
          <Plus className="h-4 w-4 mr-2" /> Add lounge
        </Button>
      </div>
      <ViewTabs table="lounges" />
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
        title="Delete lounge"
        description="This will permanently delete this lounge."
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteId != null) deleteMutation.mutate({ id: deleteId }, { onSuccess: () => setDeleteId(null) })
        }}
      />
    </div>
  )
}
