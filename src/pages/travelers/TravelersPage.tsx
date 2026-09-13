import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { type ColumnDef } from '@tanstack/react-table'
import { Trash2, Eye } from 'lucide-react'
import { DataTable } from '@/components/DataTable'
import { ConfirmDeleteDialog } from '@/components/ConfirmDeleteDialog'
import { Button } from '@/components/ui/button'
import { useTravelers, useDeleteTraveler } from '@/hooks/useTravelers'
import type { AdminTraveler } from '@/types'

const PAGE_SIZE = 50

export function TravelersPage() {
  const [page, setPage] = useState(1)
  const { data, isLoading } = useTravelers(page, PAGE_SIZE)
  const deleteMutation = useDeleteTraveler()
  const navigate = useNavigate()
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const columns: ColumnDef<AdminTraveler>[] = [
    { accessorKey: 'email', header: 'Email' },
    { accessorKey: 'displayName', header: 'Display Name', cell: ({ row }) => row.original.displayName ?? '—' },
    { accessorKey: 'countryCode', header: 'Country', cell: ({ row }) => row.original.countryCode ?? '—' },
    {
      accessorKey: 'createdUtc',
      header: 'Registered',
      cell: ({ row }) => new Date(row.original.createdUtc).toLocaleDateString(),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex gap-2 justify-end">
          <Button size="sm" variant="ghost" onClick={() => navigate(`/travelers/${row.original.id}`)}>
            <Eye className="h-4 w-4" />
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
      <h1 className="text-2xl font-bold text-gray-900">Travelers</h1>
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
        title="Delete traveler"
        description="This will permanently delete the traveler and all their data."
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteId) deleteMutation.mutate(deleteId, { onSuccess: () => setDeleteId(null) })
        }}
      />
    </div>
  )
}
