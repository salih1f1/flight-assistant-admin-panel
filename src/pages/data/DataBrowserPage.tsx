import { useCallback, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/components/DataTable'
import { MaskedBadge, RevealableValue } from '@/components/RevealableValue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ViewTabs } from '@/components/ViewTabs'
import {
  adminVerifyAirline, adminVerifyAirport, adminVerifyAlliance, adminVerifyCountry, adminVerifyLounge,
  adminVerifyLoungeProvider, adminVerifyLoyaltyProgram, adminVerifyLoyaltyProgramKind,
  getAdminGetBrowsableTableDataQueryKey, useAdminGetBrowsableTableData, useAdminListBrowsableTables,
} from '@/api/generated/admin'
import { apiErrorMessage } from '@/lib/apiError'
import { ExportCsvButton } from './ExportCsvButton'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 50

// SensitiveProperties.RedactedPlaceholder: what the API sends in place of a sensitive value.
const MASKED = '<redacted>'

/**
 * The reference data tables that can be verified: PATCH /admin/{slug}/{id}/verify exists for
 * exactly these slugs, and their data browser rows carry IsVerified, VerifiedAt and VerifiedBy.
 * The typed admin DTOs have no verified state, which is why verifying lives here.
 */
const VERIFIERS: Record<string, (id: number, body: { isVerified: boolean }) => Promise<void>> = {
  airports: adminVerifyAirport,
  airlines: adminVerifyAirline,
  alliances: adminVerifyAlliance,
  countries: adminVerifyCountry,
  lounges: adminVerifyLounge,
  'lounge-providers': adminVerifyLoungeProvider,
  'loyalty-programs': adminVerifyLoyaltyProgram,
  'loyalty-program-kinds': adminVerifyLoyaltyProgramKind,
}

const VERIFIED_FILTERS: { label: string; filter: string | undefined }[] = [
  { label: 'All', filter: undefined },
  { label: 'Verified', filter: 'IsVerified:true' },
  { label: 'Unverified', filter: 'IsVerified:false' },
]

type VerifyTarget = { table: string; id: number; isVerified: boolean }

type Row = Record<string, unknown>

/**
 * The read-only data browser over GET /admin/data/{table}. Rows arrive as
 * dictionaries keyed by the entity's PascalCase column names, in the API's column
 * order; sensitive columns are already masked server-side.
 *
 * The table is in the path and page, sort and filter are in the query string, so a
 * view survives a reload and can be shared. Sort and filter column names go to the
 * API as they appear in the rows (the API matches them case-sensitively).
 *
 * A masked value can be revealed, audited (RevealableValue). Each is keyed by table, row id
 * and column, so a different page, sort or filter mounts fresh, masked values.
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

  const queryClient = useQueryClient()
  const verifier = table ? VERIFIERS[table] : undefined
  const verify = useMutation({
    mutationFn: ({ table: slug, id, isVerified }: VerifyTarget) => VERIFIERS[slug](id, { isVerified }),
    // Every page, sort and filter of this table: a verified row may now fall out of an Unverified view.
    onSuccess: (_, { table: slug }) => queryClient.invalidateQueries({ queryKey: getAdminGetBrowsableTableDataQueryKey(slug) }),
  })

  /** Changes the view in the URL. Any change other than paging starts again at page 1. */
  const updateView = useCallback((changes: { page?: number; sort?: string; filter?: string }) => {
    const next = new URLSearchParams(searchParams)
    // page comes only from `changes`, so leaving it out resets to page 1.
    const values = {
      page: changes.page,
      sort: searchParams.get('sort') ?? undefined,
      filter: searchParams.get('filter') ?? undefined,
      ...changes,
    }
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined || value === '' || (key === 'page' && value === 1)) next.delete(key)
      else next.set(key, String(value))
    }
    setSearchParams(next)
  }, [searchParams, setSearchParams])

  const items = (rows.data?.items ?? []) as Row[]
  const columnNames = items.length > 0 ? Object.keys(items[0]) : []
  const selected = tables.data?.find(t => t.slug === table)

  const toggleSort = useCallback(
    (column: string) => updateView({ sort: sort === column ? `-${column}` : sort === `-${column}` ? undefined : column }),
    [sort, updateView],
  )

  // Memoized so cell renderers keep their identity until the view changes. The table mounts each
  // renderer as a component, so a new function per render would remount every cell and drop a
  // revealed value on any re-render, e.g. a refetch that brings changed rows into the same view.
  const columnKey = columnNames.join('|')
  const dataColumns = useMemo<ColumnDef<Row>[]>(() => (columnKey ? columnKey.split('|') : []).map(name => ({
    id: name,
    accessorFn: row => row[name],
    header: () => (
      <button type="button" onClick={() => toggleSort(name)} className="font-medium hover:text-gray-900">
        {name}
        {sort === name ? ' ↑' : sort === `-${name}` ? ' ↓' : ''}
      </button>
    ),
    cell: ({ row }) => {
      const value = row.original[name]
      // Every table with a sensitive column is keyed by a single Id, which is what the reveal endpoint takes.
      const id = row.original.Id
      if (value !== MASKED || id === null || id === undefined || !table) return <Cell value={value} />
      // Keyed so another row, page, sort or filter never inherits a revealed value.
      return <RevealableValue key={`${table}|${String(id)}|${name}`} table={table} id={String(id)} column={name} />
    },
  })), [columnKey, table, sort, toggleSort])

  // The verify routes take a numeric id ({id:int}). Countries is verifiable but keyed by Code with
  // no Id column, so it can't be verified from here; Number(undefined) used to send /NaN/verify.
  const verifiableRows = verifier !== undefined && items.some(row => typeof row.Id === 'number')
  // A new array, never a push: dataColumns is memoized and must not grow a verify column per render.
  const columns: ColumnDef<Row>[] = verifiableRows && table ? [
    ...dataColumns,
    {
      id: 'verify',
      header: () => <span className="sr-only">Verify</span>,
      cell: ({ row }) => {
        const id = row.original.Id
        if (typeof id !== 'number') return null
        const verified = row.original.IsVerified === true
        return (
          <Button
            size="sm"
            variant="outline"
            disabled={verify.isPending}
            onClick={() => verify.mutate({ table, id, isVerified: !verified })}
          >
            {verified ? 'Unverify' : 'Verify'}
          </Button>
        )
      },
    },
  ] : dataColumns

  // The route always carries a table: the side menu lists them, and /data redirects to the dashboard.
  if (!table) return null

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{selected?.displayName ?? table}</h1>
          <p className="text-sm text-gray-500">Read-only. Sensitive columns are masked by the API; revealing one is audited.</p>
        </div>
        <ViewTabs table={table} />
      </div>

      <div className="min-w-0 space-y-4">
        {verifier && (
          // The API takes one filter, so choosing one of these replaces any column filter.
          <div role="group" aria-label="Verified filter" className="inline-flex overflow-hidden rounded-md border border-gray-200">
            {VERIFIED_FILTERS.map(option => (
              <button
                key={option.label}
                type="button"
                aria-pressed={filter === option.filter}
                onClick={() => updateView({ filter: option.filter })}
                className={cn('px-3 py-1.5 text-sm', filter === option.filter ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50')}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
        {verifier && items.length > 0 && !verifiableRows && (
          <p className="text-sm text-gray-500">
            {`Verifying isn't available for ${selected?.displayName ?? table}: the API's verify route takes a numeric id, and these rows have none.`}
          </p>
        )}
        <ExportCsvButton key={table} table={table} tableName={selected?.displayName ?? table} />
        <FilterForm
          // Remount when the applied filter or table changes, so the inputs show what's applied.
          key={`${table}|${filter ?? ''}`}
          columns={columnNames}
          filter={filter}
          onApply={value => updateView({ filter: value })}
          onClear={() => updateView({ filter: undefined })}
        />
        {verify.error && verify.variables?.table === table && (
          <VerifyError error={verify.error} target={verify.variables} />
        )}
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
      </div>
    </div>
  )
}

function Cell({ value }: { value: unknown }) {
  if (value === MASKED) return <MaskedBadge />
  if (value === null || value === undefined) return <span className="text-gray-400">—</span>
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  return <span className="block max-w-xs truncate" title={text}>{text}</span>
}

function VerifyError({ error, target }: { error: unknown; target: VerifyTarget }) {
  // The verify endpoints answer a missing row with an empty 404 (Results.NotFound()), not ProblemDetails.
  const status = (error as { response?: { status?: number } } | null)?.response?.status
  const { title, detail } = status === 404
    ? { title: 'it no longer exists. Refresh to see the current rows.', detail: undefined }
    : apiErrorMessage(error)
  return (
    <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      <p>{`Couldn't ${target.isVerified ? 'verify' : 'unverify'} row ${target.id}: ${title}`}</p>
      {detail && <p className="mt-1 text-xs text-red-600">{detail}</p>}
    </div>
  )
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
