import { Link } from 'react-router-dom'
import { Eye, Pencil, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

const iconLink = 'inline-flex h-9 w-9 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900'

/** A grid row's actions, each shown only when the table supports it: Sync, Open, Edit and Delete. */
export function RowActions({ openTo, editTo, onSync, syncing, onDelete }: {
  openTo?: string
  editTo?: string
  onSync?: () => void
  syncing?: boolean
  onDelete?: () => void
}) {
  return (
    <div className="flex items-center justify-end gap-1">
      {onSync && (
        <Button size="sm" variant="ghost" aria-label="Sync status" title="Sync status" disabled={syncing} onClick={onSync}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      )}
      {openTo && (
        <Link to={openTo} aria-label="Open record" title="Open" className={iconLink}>
          <Eye className="h-4 w-4" />
        </Link>
      )}
      {editTo && (
        <Link to={editTo} aria-label="Edit record" title="Edit" className={iconLink}>
          <Pencil className="h-4 w-4" />
        </Link>
      )}
      {onDelete && (
        <Button size="sm" variant="ghost" aria-label="Delete record" title="Delete" className="text-red-500 hover:text-red-700" onClick={onDelete}>
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
    </div>
  )
}
