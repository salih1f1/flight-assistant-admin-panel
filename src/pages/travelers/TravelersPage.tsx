import { useState } from 'react'
import { keepPreviousData, useQueryClient } from '@tanstack/react-query'
import { type ColumnDef } from '@tanstack/react-table'
import { Trash2 } from 'lucide-react'
import { DataTable } from '@/components/DataTable'
import { ConfirmDeleteDialog } from '@/components/ConfirmDeleteDialog'
import { Button } from '@/components/ui/button'
import { useAdminDeleteTraveler, useAdminGetAllTravelers } from '@/api/generated/admin'
import type { AdminTravelerDto } from '@/api/generated/model'
import { invalidateTravelers } from '@/api/cache'

const PAGE_SIZE = 50

export function TravelersPage() {
  const [page, setPage] = useState(1)
  const queryClient = useQueryClient()
  const { data, isLoading, error } = useAdminGetAllTravelers(
    { Page: page, PageSize: PAGE_SIZE },
    { query: { placeholderData: keepPreviousData } },
  )
  const deleteMutation = useAdminDeleteTraveler({ mutation: { onSuccess: () => invalidateTravelers(queryClient) } })
  const [deleteId, setDeleteId] = useState<string | null>(null)

  // No country column: AdminTravelerDto has no country field.
  const columns: ColumnDef<AdminTravelerDto>[] = [
    { accessorKey: 'email', header: 'Email' },
    { accessorKey: 'displayName', header: 'Display Name', cell: ({ row }) => row.original.displayName ?? '—' },
    {
      accessorKey: 'createdUtc',
      header: 'Registered',
      cell: ({ row }) => {
        const created = row.original.createdUtc
        return created ? new Date(created).toLocaleDateString() : '—'
      },
    },
    // No view button: the panel has no traveler page yet.
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex gap-2 justify-end">
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
      <h1 className="text-2xl font-bold text-gray-900">Travelers</h1>
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
        title="Delete traveler"
        description="This will permanently delete the traveler and all their data."
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteId) deleteMutation.mutate({ id: deleteId }, { onSuccess: () => setDeleteId(null) })
        }}
      />
    </div>
  )
}
