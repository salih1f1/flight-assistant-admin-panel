import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { type ColumnDef } from '@tanstack/react-table'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { DataTable } from '@/components/DataTable'
import { ConfirmDeleteDialog } from '@/components/ConfirmDeleteDialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useLoyaltyPrograms, useDeleteLoyaltyProgram } from '@/hooks/useLoyalty'
import type { LoyaltyProgram } from '@/types'

export function LoyaltyProgramsPage() {
  const { data = [], isLoading } = useLoyaltyPrograms()
  const deleteMutation = useDeleteLoyaltyProgram()
  const navigate = useNavigate()
  const [deleteId, setDeleteId] = useState<number | null>(null)

  const columns: ColumnDef<LoyaltyProgram>[] = [
    { accessorKey: 'code', header: 'Code', cell: ({ row }) => <Badge variant="outline">{row.original.code}</Badge> },
    { accessorKey: 'name', header: 'Name' },
    { accessorKey: 'kind', header: 'Kind' },
    { accessorKey: 'allianceCode', header: 'Alliance', cell: ({ row }) => row.original.allianceCode ?? '—' },
    { id: 'tiers', header: 'Tiers', cell: ({ row }) => row.original.tiers.length },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex gap-2 justify-end">
          <Button size="sm" variant="ghost" onClick={() => navigate(`/loyalty/${row.original.id}/edit`)}>
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
        <h1 className="text-2xl font-bold text-gray-900">Loyalty Programs</h1>
        <Button onClick={() => navigate('/loyalty/new')}>
          <Plus className="h-4 w-4 mr-2" /> Add program
        </Button>
      </div>
      <DataTable columns={columns} data={data} searchPlaceholder="Search programs…" searchColumn="name" />
      <ConfirmDeleteDialog
        open={!!deleteId}
        onOpenChange={open => !open && setDeleteId(null)}
        title="Delete loyalty program"
        description="This will remove the program and all its tiers."
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteId != null) deleteMutation.mutate(deleteId, { onSuccess: () => setDeleteId(null) })
        }}
      />
    </div>
  )
}
