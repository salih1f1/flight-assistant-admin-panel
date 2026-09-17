import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type CellContext, type ColumnDef } from '@tanstack/react-table'
import { Plus } from 'lucide-react'
import { ConfirmDeleteDialog } from '@/components/ConfirmDeleteDialog'
import { DataTable } from '@/components/DataTable'
import { MaskedBadge, RevealableValue } from '@/components/RevealableValue'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  adminRetryVerificationRequest, adminSyncFlightStatus, getAdminGetBrowsableTableDataQueryKey,
  getAdminGetVerificationNeedsAttentionQueryKey, useAdminGetBrowsableTableData, useAdminListBrowsableTables,
} from '@/api/generated/admin'
import { invalidateRawTables } from '@/api/cache'
import { apiErrorMessage } from '@/lib/apiError'
import { ExportCsvButton } from './ExportCsvButton'
import { DELETERS, EDITABLE, lookup, MASKED, recordKey, recordPath, VERIFIERS } from './records'
import { RowActions } from './RowActions'
import { syncResultMessage } from '../flights/syncOutcome'
import { SYNC_LEGEND, syncRowTone } from './syncRowTone'
import { VerificationStatusBadge } from './VerificationStatus'
import { CHECKED_COLUMNS } from './verificationChecks'
import { VerifyDialog } from './VerifyDialog'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 50

/**
 * What the flights grid's row colours mean. A list rather than a row of spans so the states are
 * announced as the set they are, and each swatch is labelled — the colour is a shorthand for the
 * SyncMode column beside it, never the only way to read a row.
 */
function SyncLegend() {
  return (
    <ul aria-label="Sync colours" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
      {SYNC_LEGEND.map(({ label, tone }) => (
        <li key={label} className="flex items-center gap-1.5">
          <span aria-hidden className={cn('inline-block h-3 w-3 rounded-sm', tone)} />
          {label}
        </li>
      ))}
    </ul>
  )
}

/** The one table whose rows are tinted by sync mode, and whose row actions include Sync. */
const FLIGHTS_TABLE = 'flights'

/** How a sync line names its flight: its number, or its id when the column is hidden or empty. */
const flightLabel = (flight: Row) => String(flight.FlightNumber ?? `flight ${flight.Id}`)

// Retry belongs to this one table's grid, the same way Sync belongs to flights only — never
// offered generically to every table.
const VERIFICATION_REQUESTS_TABLE = 'verification-requests'

const VERIFIED_FILTERS: { label: string; filter: string | undefined }[] = [
  { label: 'All', filter: undefined },
  { label: 'Verified', filter: 'IsVerified:true' },
  { label: 'Unverified', filter: 'IsVerified:false' },
]

/**
 * Bookkeeping columns, hidden until shown: who and where a record came from, and raw
 * payloads. The record page always shows them.
 */
const HIDDEN_COLUMNS = new Set([
  'SourceType', 'FirstSeenAt',
  'VerifiedAt', 'VerifiedBy', 'VerificationSource', 'VerificationIssue', 'Notes', 'RawPayloadJson', 'DedupHash',
])

type VerifyTarget = { table: string; key: string; isVerified: boolean }

type Row = Record<string, unknown>

type SelectionContextValue = {
  keyColumn: string
  selectedKeys: Set<string>
  allSelected: boolean
  someSelected: boolean
  toggleRow: (key: string) => void
  toggleAllRows: () => void
}

/**
 * Carries the checkbox column's live selection state down to SelectAllHeader/SelectRowCell without
 * those two closing over it directly. `columns` is rebuilt every render (see the comment above
 * `dataColumns`), and TanStack Table's `flexRender` treats each `header`/`cell` function as its own
 * component type — a fresh inline closure there would mount a brand new checkbox every render,
 * dropping DOM focus after each click or Space press. Reading the selection through context instead
 * lets `header`/`cell` stay two permanently stable, module-level function references (`SELECT_COLUMN`
 * below), so a selection change only re-renders the existing checkboxes instead of remounting them.
 */
const SelectionContext = createContext<SelectionContextValue | null>(null)

function SelectAllHeader() {
  const selection = useContext(SelectionContext)
  if (!selection) return null
  return (
    <input
      type="checkbox"
      aria-label="Select all rows on this page"
      checked={selection.allSelected}
      ref={el => { if (el) el.indeterminate = selection.someSelected }}
      onChange={selection.toggleAllRows}
    />
  )
}

function SelectRowCell({ row }: CellContext<Row, unknown>) {
  const selection = useContext(SelectionContext)
  if (!selection) return null
  const keyValue = row.original[selection.keyColumn]
  // A row with no value in the key column has nothing a selection could refer back to.
  if (keyValue === null || keyValue === undefined) return null
  const key = String(keyValue)
  return (
    <input
      type="checkbox"
      aria-label={`Select row ${key}`}
      checked={selection.selectedKeys.has(key)}
      onChange={() => selection.toggleRow(key)}
    />
  )
}

/** Module scope, not built inline: the one thing that actually needs to survive every render unchanged. */
const SELECT_COLUMN: ColumnDef<Row> = { id: 'select', header: SelectAllHeader, cell: SelectRowCell }

/**
 * The checkbox column's selection state, scoped to one view (table + page + sort + filter):
 * changing any of them drops the selection, and returning to an earlier view does not restore it —
 * comparing the view against the previous render's and resetting when it differs adjusts state while
 * rendering rather than in an effect. `selectedRows` is `items` intersected with the stored keys, in
 * grid order, so a row that leaves the page (e.g. a refetch after it stops matching an Unverified
 * filter) simply stops counting without the stored keys themselves being touched.
 */
function useRowSelection(items: Row[], keyColumn: string | undefined, viewKey: string) {
  const [selectionView, setSelectionView] = useState(viewKey)
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  if (viewKey !== selectionView) {
    setSelectionView(viewKey)
    setSelectedKeys(new Set())
  }

  if (!keyColumn) {
    return {
      selectedRows: [] as Row[], selectedKeys, allSelected: false, someSelected: false,
      toggleRow: () => {}, toggleAllRows: () => {},
    }
  }

  const selectableItems = items.filter(row => row[keyColumn] !== null && row[keyColumn] !== undefined)
  const selectedRows = items.filter(row => selectedKeys.has(String(row[keyColumn])))
  const allSelected = selectableItems.length > 0 && selectableItems.every(row => selectedKeys.has(String(row[keyColumn])))
  const someSelected = !allSelected && selectableItems.some(row => selectedKeys.has(String(row[keyColumn])))

  const toggleRow = (key: string) => setSelectedKeys(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })
  const toggleAllRows = () => setSelectedKeys(prev => {
    const next = new Set(prev)
    const keys = selectableItems.map(row => String(row[keyColumn]))
    if (allSelected) keys.forEach(key => next.delete(key))
    else keys.forEach(key => next.add(key))
    return next
  })

  return { selectedRows, selectedKeys, allSelected, someSelected, toggleRow, toggleAllRows }
}

/**
 * A table's grid over GET /admin/data/{table}, and the one list page for every entity. Rows arrive
 * as dictionaries keyed by the entity's PascalCase column names, in the API's column order;
 * sensitive columns are already masked server-side.
 *
 * The table is in the path and page, sort, filter and shown columns are in the query string, so a
 * view survives a reload and can be shared. Sort and filter column names go to the API as they
 * appear in the rows (the API matches them case-sensitively).
 *
 * Each row opens its record, and the table's typed API adds Edit, Delete, (for flights) Sync and
 * (for verification requests whose Status is Error) Retry. A masked value can be revealed,
 * audited (RevealableValue). Each is keyed by table, row id and column, so a different page,
 * sort or filter mounts fresh, masked values.
 */
export function DataBrowserPage() {
  const { table } = useParams<{ table: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const page = Math.max(1, Number(searchParams.get('page')) || 1)
  const sort = searchParams.get('sort') ?? undefined
  const filter = searchParams.get('filter') ?? undefined
  const showAll = searchParams.get('columns') === 'all'

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
  const verifier = table ? lookup(VERIFIERS, table) : undefined
  const keyColumn = table ? recordKey(table) : undefined
  const [verifyDialogOpen, setVerifyDialogOpen] = useState(false)

  const verify = useMutation({
    mutationFn: ({ table: slug, key, isVerified }: VerifyTarget) => VERIFIERS[slug](key, { isVerified }),
    onSuccess: (_, { table: slug }) => {
      // Every page, sort and filter of this table: a verified row may now fall out of an Unverified view.
      void queryClient.invalidateQueries({ queryKey: getAdminGetBrowsableTableDataQueryKey(slug) })
      // The dashboard card's counts: verifying from the filtered "needs attention" grid this row
      // linked from would otherwise leave the card showing a stale count for up to five minutes,
      // pointing an admin back at a grid that's already empty.
      void queryClient.invalidateQueries({ queryKey: getAdminGetVerificationNeedsAttentionQueryKey() })
    },
  })

  const editable = table ? lookup(EDITABLE, table) : undefined
  const deleter = table ? lookup(DELETERS, table) : undefined
  const [deleting, setDeleting] = useState<Row | null>(null)
  const remove = useMutation({
    mutationFn: ({ table: slug, row }: { table: string; row: Row }) => DELETERS[slug].remove(row),
    // Every raw table: a delete can cascade, e.g. a traveler's device tokens go with them.
    onSuccess: () => invalidateRawTables(queryClient),
    onSettled: () => setDeleting(null),
  })
  const sync = useMutation({
    mutationFn: (flight: Row) => adminSyncFlightStatus(Number(flight.Id)),
    // The flight's times change, and the sync records status events.
    onSuccess: () => invalidateRawTables(queryClient),
  })
  const retry = useMutation({
    // The request's own Id column, never the entity key: the route is scoped to one check, not
    // one entity. Carries `table` alongside it, the same way `remove` does below, so the banners
    // can tell this table's own last retry apart from one left over from a table the admin has
    // since switched away from.
    mutationFn: ({ row }: { table: string; row: Row }) => adminRetryVerificationRequest(Number(row.Id)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getAdminGetBrowsableTableDataQueryKey(VERIFICATION_REQUESTS_TABLE) }),
  })
  // Retry is the one row action with a success line, not just an error one (Sync/Delete/Verify
  // only ever show a failure), so its result must not survive leaving this table and coming back.
  // DataBrowserPage never remounts on a plain :table param change — Tasks 1 and 2 rely on that to
  // keep the row selection and the Verify dialog alive across it — so the retry mutation itself
  // would otherwise outlive the switch, and `retry.variables?.table === table` below would be
  // true again on return, showing the same banner as if a fresh retry had just run. Comparing
  // `table` against the previous render's value and resetting on a change is this file's own
  // "adjust state while rendering" idiom (selectionView/dialogView elsewhere in this component).
  //
  // Sync grew a success line in #81 and is now in exactly the same position, so it resets here too.
  const [retryTable, setRetryTable] = useState(table)
  if (table !== retryTable) {
    setRetryTable(table)
    retry.reset()
    sync.reset()
  }

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

  const toggleAllColumns = () => {
    const next = new URLSearchParams(searchParams)
    if (showAll) next.delete('columns')
    else next.set('columns', 'all')
    setSearchParams(next)
  }

  const items = (rows.data?.items ?? []) as Row[]
  const columnNames = items.length > 0 ? Object.keys(items[0]) : []
  // A column masked on every row says nothing in a grid; the record page reveals it.
  const hiddenNames = columnNames.filter(name => HIDDEN_COLUMNS.has(name) || items.every(row => row[name] === MASKED))
  const visibleNames = showAll ? columnNames : columnNames.filter(name => !hiddenNames.includes(name))
  // Independent of the "show all" toggle: the Manually dialog's default columns are the grid's
  // normal view, not whatever the admin currently has expanded.
  const defaultVisibleNames = columnNames.filter(name => !hiddenNames.includes(name))
  const selected = tables.data?.find(t => t.slug === table)

  const viewKey = `${table ?? ''}|${page}|${sort ?? ''}|${filter ?? ''}`
  const selection = useRowSelection(items, keyColumn, viewKey)
  const selectedRows = selection.selectedRows

  // Closes on the same view change (table, page, sort or filter) that drops the selection: otherwise
  // Back could leave the dialog open against a different table's rows and key column, or leave a
  // running Verify all shown still sending requests for a view the admin has already left.
  // VerifyDialog's own effect (keyed on its `open` prop) is what actually stops an in-flight run once
  // this closes it.
  const [dialogView, setDialogView] = useState(viewKey)
  if (viewKey !== dialogView) {
    setDialogView(viewKey)
    setVerifyDialogOpen(false)
  }

  const toggleSort = useCallback(
    (column: string) => updateView({ sort: sort === column ? `-${column}` : sort === `-${column}` ? undefined : column }),
    [sort, updateView],
  )

  // Memoized so cell renderers keep their identity until the view changes. The table mounts each
  // renderer as a component, so a new function per render would remount every cell and drop a
  // revealed value on any re-render, e.g. a refetch that brings changed rows into the same view.
  const columnKey = visibleNames.join('|')
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
      // The one column a verifiable table's badge replaces; non-verifiable tables keep the raw value.
      if (name === 'IsVerified' && verifier) return <VerificationStatusBadge row={row.original} />
      // Every table with a sensitive column is keyed by a single Id, which is what the reveal endpoint takes.
      const id = row.original.Id
      if (value !== MASKED || id === null || id === undefined || !table) return <Cell value={value} />
      // Keyed so another row, page, sort or filter never inherits a revealed value.
      return <RevealableValue key={`${table}|${String(id)}|${name}`} table={table} id={String(id)} column={name} />
    },
  })), [columnKey, table, sort, toggleSort, verifier])

  // The route always carries a table: the side menu lists them, and /data redirects to the dashboard.
  if (!table) return null

  // The dialog itself prepends the key column and appends Status, so this is only the middle
  // segment: the §3 checked columns where they exist, else the grid's own default-visible columns.
  const checkedColumns = lookup(CHECKED_COLUMNS, table)
  const manualColumns = checkedColumns ? [...checkedColumns] : defaultVisibleNames.filter(name => name !== 'IsVerified')

  // A new array, never a push: dataColumns is memoized and must not grow a column per render.
  // SELECT_COLUMN is a stable, module-level reference (see its comment) — never rebuilt here.
  const columns: ColumnDef<Row>[] = [
    ...(verifier && keyColumn ? [SELECT_COLUMN] : []),
    ...dataColumns,
    ...(verifier ? [{
      id: 'verify',
      header: () => <span className="sr-only">Verify</span>,
      cell: ({ row }) => {
        const keyValue = keyColumn ? row.original[keyColumn] : undefined
        if (keyValue === null || keyValue === undefined) return null
        const key = String(keyValue)
        const verified = row.original.IsVerified === true
        return (
          <Button
            size="sm"
            variant="outline"
            disabled={verify.isPending}
            onClick={() => verify.mutate({ table, key, isVerified: !verified })}
          >
            {verified ? 'Unverify' : 'Verify'}
          </Button>
        )
      },
    } satisfies ColumnDef<Row>] : []),
    {
      id: 'actions',
      header: () => null,
      cell: ({ row }) => {
        const openTo = recordPath(table, row.original)
        // Only a request that actually failed is worth retrying; a Mismatch is resolved from the
        // record page instead, by taking a source's values or verifying by hand.
        const canRetry = table === VERIFICATION_REQUESTS_TABLE && row.original.Status === 'Error'
        return (
          <RowActions
            openTo={openTo}
            editTo={editable && openTo ? `${openTo}?mode=edit` : undefined}
            onSync={table === 'flights' ? () => sync.mutate(row.original) : undefined}
            syncing={sync.isPending}
            onRetry={canRetry ? () => retry.mutate({ table, row: row.original }) : undefined}
            retrying={retry.isPending}
            onDelete={deleter ? () => setDeleting(row.original) : undefined}
          />
        )
      },
    },
  ]

  const hiddenWord = hiddenNames.length === 1 ? 'column' : 'columns'
  const selectionContextValue = verifier && keyColumn ? {
    keyColumn,
    selectedKeys: selection.selectedKeys,
    allSelected: selection.allSelected,
    someSelected: selection.someSelected,
    toggleRow: selection.toggleRow,
    toggleAllRows: selection.toggleAllRows,
  } : null

  return (
    <SelectionContext.Provider value={selectionContextValue}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{selected?.displayName ?? table}</h1>
            <p className="text-sm text-gray-500">Sensitive columns are masked by the API; revealing one is audited.</p>
          </div>
          {editable && (
            <Link to={editable.newPath} className={buttonVariants()}>
              <Plus className="mr-2 h-4 w-4" /> {`Add ${editable.noun}`}
            </Link>
          )}
        </div>

        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
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
            {/* Opens the Verify dialog on the rows selected via the checkbox column. */}
            {verifier && (
              <Button variant="outline" size="sm" disabled={selectedRows.length === 0} onClick={() => setVerifyDialogOpen(true)}>
                {`Verify selected (${selectedRows.length})`}
              </Button>
            )}
            {/* Only where it changes something: some tables have no bookkeeping or masked columns. */}
            {hiddenNames.length > 0 && (
              <Button variant="outline" size="sm" onClick={toggleAllColumns}>
                {showAll ? `Hide ${hiddenNames.length} ${hiddenWord}` : `Show ${hiddenNames.length} hidden ${hiddenWord}`}
              </Button>
            )}
          </div>
          <ExportCsvButton key={table} table={table} tableName={selected?.displayName ?? table} />
          <FilterForm
            // Remount when the applied filter or table changes, so the inputs show what's applied.
            key={`${table}|${filter ?? ''}`}
            // Every column, hidden or not: filtering on one doesn't need it on screen.
            columns={columnNames}
            filter={filter}
            onApply={value => updateView({ filter: value })}
            onClear={() => updateView({ filter: undefined })}
          />
          {verify.error && verify.variables?.table === table && (
            <VerifyError error={verify.error} target={verify.variables} />
          )}
          {remove.error && remove.variables?.table === table && (
            <ActionError
              text={`Couldn't delete ${DELETERS[table]?.noun ?? 'row'} ${String(remove.variables.row.Id)}`}
              error={remove.error}
            />
          )}
          {sync.error && table === 'flights' && sync.variables && (
            <ActionError text={`Could not sync ${flightLabel(sync.variables)}`} error={sync.error} />
          )}
          {sync.isSuccess && table === 'flights' && sync.variables && (
            <p role="status" className="text-sm text-gray-700">
              {`${flightLabel(sync.variables)}: ${syncResultMessage(sync.data)}`}
            </p>
          )}
          {retry.isSuccess && retry.variables?.table === table && (
            <p role="status" className="text-sm text-gray-700">{`Queued ${retry.data?.queued ?? 0} · skipped ${retry.data?.skipped ?? 0}`}</p>
          )}
          {retry.error && retry.variables?.table === table && (
            <ActionError text={`Could not retry request ${String(retry.variables.row.Id)}`} error={retry.error} />
          )}
          {table === FLIGHTS_TABLE && <SyncLegend />}
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
                // Flights only: every other table's rows stay plain.
                rowClassName={table === FLIGHTS_TABLE ? syncRowTone : undefined}
                pagination={{ page, pageSize: PAGE_SIZE, total: rows.data?.total ?? 0, onPageChange: p => updateView({ page: p }) }}
              />
            </div>
          )}
        </div>

        {deleter && (
          <ConfirmDeleteDialog
            open={deleting !== null}
            onOpenChange={open => !open && setDeleting(null)}
            title={`Delete ${deleter.noun}`}
            description={deleter.warning}
            loading={remove.isPending}
            onConfirm={() => deleting && remove.mutate({ table, row: deleting })}
          />
        )}

        {verifier && keyColumn && (
          <VerifyDialog
            open={verifyDialogOpen}
            onOpenChange={setVerifyDialogOpen}
            table={table}
            keyColumn={keyColumn}
            rows={selectedRows}
            manualColumns={manualColumns}
          />
        )}
      </div>
    </SelectionContext.Provider>
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
      <p>{`Couldn't ${target.isVerified ? 'verify' : 'unverify'} row ${target.key}: ${title}`}</p>
      {detail && <p className="mt-1 text-xs text-red-600">{detail}</p>}
    </div>
  )
}

function ActionError({ text, error }: { text: string; error: unknown }) {
  const { title, detail } = apiErrorMessage(error)
  return (
    <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      <p>{`${text}: ${title}`}</p>
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
