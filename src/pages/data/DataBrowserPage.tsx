import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { type ColumnDef } from '@tanstack/react-table'
import { Lock } from 'lucide-react'
import { DataTable } from '@/components/DataTable'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  getAdminGetBrowsableTableDataQueryKey, useAdminGetBrowsableTableData, useAdminListBrowsableTables,
} from '@/api/generated/admin'
import { apiErrorMessage } from '@/lib/apiError'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 50

// SensitiveProperties.RedactedPlaceholder: what the API sends in place of a sensitive value.
const MASKED = '<redacted>'

type Row = Record<string, unknown>

/**
 * The read-only data browser over GET /admin/data/{table}. Rows arrive as
 * dictionaries keyed by the entity's PascalCase column names, in the API's column
 * order; sensitive columns are already masked server-side.
 *
 * The table is in the path and page, sort and filter are in the query string, so a
 * view survives a reload and can be shared. Sort and filter column names go to the
 * API as they appear in the rows (the API matches them case-sensitively).
 */
export function DataBrowserPage() {
  const { table } = useParams<{ table: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const page = Math.max(1, Number(searchParams.get('page')) || 1)
  const sort = searchParams.get('sort') ?? undefined
  const filter = searchParams.get('filter') ?? undefined

  const tables = useAdminListBrowsableTables()
  const rows = useAdminGetBrowsableTableData(
    table ?? '',
    { Page: page, PageSize: PAGE_SIZE, sort, filter },
    {
      query: {
        enabled: !!table,
        // Keep the previous page on screen while the next one loads, but never another table's rows.
        placeholderData: (previous, previousQuery) =>
          previousQuery?.queryKey[0] === getAdminGetBrowsableTableDataQueryKey(table ?? '')[0] ? previous : undefined,
      },
    },
  )

  /** Changes the view in the URL. Any change other than paging starts again at page 1. */
  const updateView = (changes: { page?: number; sort?: string; filter?: string }) => {
    const next = new URLSearchParams(searchParams)
    // page comes only from `changes`, so leaving it out resets to page 1.
    const values = { page: changes.page, sort, filter, ...changes }
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined || value === '' || (key === 'page' && value === 1)) next.delete(key)
      else next.set(key, String(value))
    }
    setSearchParams(next)
  }

  const items = (rows.data?.items ?? []) as Row[]
  const columnNames = items.length > 0 ? Object.keys(items[0]) : []
  const selected = tables.data?.find(t => t.slug === table)

  const toggleSort = (column: string) =>
    updateView({ sort: sort === column ? `-${column}` : sort === `-${column}` ? undefined : column })

  const columns: ColumnDef<Row>[] = columnNames.map(name => ({
    id: name,
    accessorFn: row => row[name],
    header: () => (
      <button type="button" onClick={() => toggleSort(name)} className="font-medium hover:text-gray-900">
        {name}
        {sort === name ? ' ↑' : sort === `-${name}` ? ' ↓' : ''}
      </button>
    ),
    cell: ({ row }) => <Cell value={row.original[name]} />,
  }))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Data browser</h1>
        <p className="text-sm text-gray-500">Read-only. Sensitive columns are masked by the API.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-[14rem_1fr]">
        <Card>
          <CardContent className="p-2">
            {tables.error ? (
              <ErrorAlert what="tables" error={tables.error} />
            ) : tables.isLoading ? (
              <p className="p-2 text-sm text-gray-400">Loading tables…</p>
            ) : (
              <nav>
                <ul className="space-y-0.5">
                  {(tables.data ?? []).map(t => (
                    <li key={t.slug}>
                      {/* A bare path: switching tables drops the previous table's page, sort and filter. */}
                      <Link
                        to={`/data/${t.slug}`}
                        className={cn(
                          'flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm',
                          t.slug === table ? 'bg-gray-100 font-medium text-gray-900' : 'text-gray-600 hover:bg-gray-50',
                        )}
                      >
                        <span>{t.displayName}</span>
                        <span className="text-xs text-gray-400">{rowCount(t.rowCount ?? 0)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            )}
          </CardContent>
        </Card>

        <div className="min-w-0 space-y-4">
          {!table ? (
            <p className="text-sm text-gray-500">Pick a table to browse its rows.</p>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-gray-900">{selected?.displayName ?? table}</h2>
              <FilterForm
                // Remount when the applied filter or table changes, so the inputs show what's applied.
                key={`${table}|${filter ?? ''}`}
                columns={columnNames}
                filter={filter}
                onApply={value => updateView({ filter: value })}
                onClear={() => updateView({ filter: undefined })}
              />
              {rows.error ? (
                // In place of the table: an empty grid would read as "no rows match".
                <ErrorAlert what="rows" error={rows.error} />
              ) : rows.isLoading ? (
                <p className="text-sm text-gray-400">Loading rows…</p>
              ) : (
                <div className="overflow-x-auto">
                  <DataTable
                    columns={columns}
                    data={items}
                    pagination={{ page, pageSize: PAGE_SIZE, total: rows.data?.total ?? 0, onPageChange: p => updateView({ page: p }) }}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const rowCount = (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'row' : 'rows'}`

function Cell({ value }: { value: unknown }) {
  if (value === MASKED) {
    return (
      <Badge variant="secondary" className="gap-1" title="Masked by the API">
        <Lock className="h-3 w-3" />
        Masked
      </Badge>
    )
  }
  if (value === null || value === undefined) return <span className="text-gray-400">—</span>
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  return <span className="block max-w-xs truncate" title={text}>{text}</span>
}

function FilterForm({ columns, filter, onApply, onClear }: {
  columns: string[]
  filter: string | undefined
  onApply: (filter: string) => void
  onClear: () => void
}) {
  // The API splits on the first ':' only, so a value may itself contain colons.
  const separator = filter?.indexOf(':') ?? -1
  const [column, setColumn] = useState(separator >= 0 ? filter!.slice(0, separator) : '')
  const [value, setValue] = useState(separator >= 0 ? filter!.slice(separator + 1) : '')
  // Offer the applied column even when the current page has no rows to take column names from.
  const options = column && !columns.includes(column) ? [column, ...columns] : columns
  const chosen = column || options[0] || ''

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={e => {
        e.preventDefault()
        if (chosen && value) onApply(`${chosen}:${value}`)
      }}
    >
      <select
        aria-label="Filter column"
        value={chosen}
        onChange={e => setColumn(e.target.value)}
        className="h-10 rounded-md border border-gray-200 bg-white px-3 text-sm"
      >
        {options.map(name => <option key={name} value={name}>{name}</option>)}
      </select>
      <Input aria-label="Filter value" value={value} onChange={e => setValue(e.target.value)} placeholder="Value" className="max-w-xs" />
      <Button type="submit" variant="outline">Apply filter</Button>
      {filter && <Button type="button" variant="ghost" onClick={onClear}>Clear filter</Button>}
    </form>
  )
}

function ErrorAlert({ what, error }: { what: string; error: unknown }) {
  const { title, detail } = apiErrorMessage(error)
  return (
    <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      <p>Could not load {what}: {title}</p>
      {detail && <p className="mt-1 text-xs text-red-600">{detail}</p>}
    </div>
  )
}
