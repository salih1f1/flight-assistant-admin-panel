import {
  useReactTable, getCoreRowModel, getFilteredRowModel, getPaginationRowModel,
  flexRender, type ColumnDef,
} from '@tanstack/react-table'
import { useState } from 'react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * Paging owned by the API. The table renders exactly the rows it is given, and the
 * footer reports the API's total instead of counting rows on screen.
 */
export interface ServerPagination {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
}

interface DataTableProps<TData> {
  columns: ColumnDef<TData>[]
  data: TData[]
  searchPlaceholder?: string
  searchColumn?: string
  pagination?: ServerPagination
  /**
   * The list request's error, if it failed. Shown in place of the rows, because a
   * failed request otherwise hands the table [] and reads as "No results."
   */
  error?: unknown
  /**
   * Extra classes for one row, from its own data — the flights grid tints rows by sync mode.
   * Every other grid leaves it out and rows render exactly as before.
   */
  rowClassName?: (row: TData) => string
}

export function DataTable<TData>({ columns, data, searchPlaceholder = 'Search…', searchColumn, pagination, error, rowClassName }: DataTableProps<TData>) {
  const [globalFilter, setGlobalFilter] = useState('')

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    manualPagination: pagination !== undefined,
    state: { globalFilter },
    onGlobalFilterChange: setGlobalFilter,
    initialState: { pagination: { pageSize: 20 } },
  })

  const pageCount = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize)) : 0
  const canPrevious = pagination ? pagination.page > 1 : table.getCanPreviousPage()
  const canNext = pagination ? pagination.page < pageCount : table.getCanNextPage()

  return (
    <div className="space-y-4">
      {searchColumn !== undefined && (
        <Input
          placeholder={searchPlaceholder}
          value={globalFilter}
          onChange={e => setGlobalFilter(e.target.value)}
          className="max-w-sm"
        />
      )}
      <div className="rounded-md border border-gray-200 bg-white">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map(hg => (
              <TableRow key={hg.id}>
                {hg.headers.map(h => (
                  <TableHead key={h.id}>
                    {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {error ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-red-600">
                  {`Could not load: ${error instanceof Error ? error.message : 'unknown error'}`}
                </TableCell>
              </TableRow>
            ) : table.getRowModel().rows.length ? (
              table.getRowModel().rows.map(row => (
                <TableRow key={row.id} className={rowClassName?.(row.original)}>
                  {row.getVisibleCells().map(cell => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-gray-400">
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-between text-sm text-gray-500">
        <span>
          {pagination
            ? `Page ${pagination.page} of ${pageCount} · ${pagination.total} total`
            : `${table.getFilteredRowModel().rows.length} row(s)`}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => (pagination ? pagination.onPageChange(pagination.page - 1) : table.previousPage())}
            disabled={!canPrevious}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => (pagination ? pagination.onPageChange(pagination.page + 1) : table.nextPage())}
            disabled={!canNext}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  )
}
