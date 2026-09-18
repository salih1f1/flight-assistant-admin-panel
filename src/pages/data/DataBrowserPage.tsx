import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type CellContext, type ColumnDef } from '@tanstack/react-table'
import { Plus } from 'lucide-react'
import { ConfirmDeleteDialog } from '@/components/ConfirmDeleteDialog'
import { DataTable } from '@/components/DataTable'
import { TableSkeleton } from '@/components/TableSkeleton'
import { MaskedBadge, RevealableValue } from '@/components/RevealableValue'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  adminRetryVerificationRequest, adminSyncFlightStatus, getAdminGetBrowsableTableDataQueryKey,
  useAdminGetBrowsableTableData, useAdminListBrowsableTables,
} from '@/api/generated/admin'
import type { BrowsableColumnDto } from '@/api/generated/model'
import { invalidateRawTables } from '@/api/cache'
import { apiErrorMessage } from '@/lib/apiError'
import { columnValue } from './columnValue'
import { ExportCsvButton } from './ExportCsvButton'
import { filterColumns, filterControl } from './filterColumns'
import { DELETERS, EDITABLE, lookup, MASKED, recordKey, recordPath, VERIFIERS } from './records'
import { RowActions } from './RowActions'
import { syncResultMessage } from '../flights/syncOutcome'
import { SYNC_LEGEND, syncRowTone } from './syncRowTone'
import { VerificationStatusIcon } from './VerificationStatus'
import { needsAttention } from './verificationState'
import { CHECKED_COLUMNS } from './verificationChecks'
import { VerifyDialog } from './VerifyDialog'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 50

/**
 * The placeholder grid a table loads behind: about a screenful of rows, as wide as the columns the
 * API published for the table, so the page keeps its shape instead of collapsing to a line of text
 * and reading as broken. SKELETON_COLUMNS is the width for a table that publishes none.
 */
const SKELETON_ROWS = 8
const SKELETON_COLUMNS = 5

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

/** The column the verification icon is drawn in front of, on every table that has one. */
const ICON_COLUMN = 'Name'

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
  // The Verify dialog's manual mode signs a row off without showing what a check found, so a
  // flagged row must not be able to reach it — see the Verify column below. Rendered unchecked as
  // well as disabled: `selectedKeys` still holds the key of a row that was ticked before a refetch
  // brought its issue back, and useRowSelection has already stopped counting it.
  const flagged = needsAttention(row.original)
  return (
    <input
      type="checkbox"
      aria-label={`Select row ${key}`}
      checked={!flagged && selection.selectedKeys.has(key)}
      disabled={flagged}
      title={flagged ? 'Open this row to see what the check found' : undefined}
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

  // Needs a key to refer back to, and no unresolved verification issue: a flagged row is decided on
  // its record page, so neither "select all" nor a stored key from before it was flagged may hand
  // one to the Verify dialog.
  const selectable = (row: Row) =>
    row[keyColumn] !== null && row[keyColumn] !== undefined && !needsAttention(row)
  const selectableItems = items.filter(selectable)
  const selectedRows = items.filter(row => selectable(row) && selectedKeys.has(String(row[keyColumn])))
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
/**
 * The grid as the router mounts it: one instance per table, never one instance re-pointed at
 * another table. Keeping the same instance across a table change made React re-render the whole
 * grid inside the navigation's transition without ever settling it, so nothing committed until the
 * transition expired — the panel sat on the old table for exactly five seconds, with the sidebar
 * still marking it and no loading state on screen, because the bar and the skeleton were in the
 * tree React had not committed (#123). Mounting fresh is the path that was always fast.
 *
 * It is also what the grid means: a different table is a different grid, and state raised against
 * one table's rows — a delete confirmation, a revealed value — has nothing to say about the next.
 */
export function DataBrowserRoute() {
  const { table } = useParams<{ table: string }>()
  return <DataBrowserPage key={table} />
}

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
  // The rows the Verify dialog is open on, or null for closed: the checkbox selection when the
  // toolbar opened it, the one row when its own Verify button did. Nothing in the grid verifies
  // directly any more — every verify goes through that dialog, which is what shows the row's data
  // and the choice between verifying by hand and queueing an outside source's check.
  const [verifyRows, setVerifyRows] = useState<Row[] | null>(null)

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
  // A column masked on every row says nothing in a grid; the record page reveals it. IsVerified
  // joins them on a verifiable table: the verification column below already says what it means, in
  // less room than a column of its own, so the raw true/false is kept for the toggle rather than
  // shown twice. A table with no verifier has no such column and keeps IsVerified in place.
  const hiddenNames = columnNames.filter(name =>
    HIDDEN_COLUMNS.has(name)
    || (name === 'IsVerified' && verifier !== undefined)
    || items.every(row => row[name] === MASKED))
  const visibleNames = showAll ? columnNames : columnNames.filter(name => !hiddenNames.includes(name))
  // Independent of the "show all" toggle: the Manually dialog's default columns are the grid's
  // normal view, not whatever the admin currently has expanded.
  const defaultVisibleNames = columnNames.filter(name => !hiddenNames.includes(name))
  const selected = tables.data?.find(t => t.slug === table)

  // A row's verification state belongs beside the name that identifies it, not at the far end of a
  // wide table. Set only where the table actually has that column: all 8 verifiable tables do, and
  // if one ever doesn't, the verify column below keeps the icon rather than the state vanishing.
  const iconColumn = verifier && visibleNames.includes(ICON_COLUMN) ? ICON_COLUMN : undefined

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
    setVerifyRows(null)
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
      // Every table with a sensitive column is keyed by a single Id, which is what the reveal endpoint takes.
      const id = row.original.Id
      const content = value !== MASKED || id === null || id === undefined || !table
        ? <Cell column={name} value={value} row={row.original} />
        // Keyed so another row, page, sort or filter never inherits a revealed value.
        : <RevealableValue key={`${table}|${String(id)}|${name}`} table={table} id={String(id)} column={name} />
      if (name !== iconColumn || !table) return content
      // min-w-0 so the name still truncates: a flex item will not shrink below its content without
      // it. jsdom can't lay this out, so that one class has no test — check it in a browser.
      return (
        <div className="flex items-center gap-2">
          <VerificationIcon table={table} row={row.original} />
          <div className="min-w-0">{content}</div>
        </div>
      )
    },
  })), [columnKey, table, sort, toggleSort, iconColumn])

  // The route always carries a table: the side menu lists them, and /data redirects to the dashboard.
  if (!table) return null

  // The dialog itself prepends the key column and appends Status, so this is only the middle
  // segment: the §3 checked columns where they exist, else the grid's own default-visible columns.
  const checkedColumns = lookup(CHECKED_COLUMNS, table)
  const manualColumns = checkedColumns ? [...checkedColumns] : [...defaultVisibleNames]

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
        // Verified rows offer nothing: unverifying belongs on the record page, which shows what the
        // verification actually was — its source, its date and who did it — rather than in a list,
        // where it would be one stray click away with none of that on screen. A flagged row offers
        // nothing either: its icon, in front of its name, is what links to the record page where
        // the difference a check found can be read. And a row with no value in the key column has
        // nothing the dialog could verify.
        const canVerify = !needsAttention(row.original)
          && row.original.IsVerified !== true
          && keyValue !== null
          && keyValue !== undefined
        return (
          <div className="flex items-center justify-end gap-2">
            {/* Only when the icon has nowhere better to be — see iconColumn above. */}
            {iconColumn === undefined && <VerificationIcon table={table} row={row.original} />}
            {canVerify && (
              <Button size="sm" variant="outline" onClick={() => setVerifyRows([row.original])}>Verify</Button>
            )}
          </div>
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
              <Button variant="outline" size="sm" disabled={selectedRows.length === 0} onClick={() => setVerifyRows(selectedRows)}>
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
            // What GET /admin/data/tables published about this table's columns (#451), so the value
            // control can match the column's kind. Undefined against an API that publishes none.
            published={tables.data?.find(t => t.slug === table)?.columns}
            onApply={value => updateView({ filter: value })}
            onClear={() => updateView({ filter: undefined })}
          />
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
            <TableSkeleton columns={selected?.columns?.length ?? SKELETON_COLUMNS} rows={SKELETON_ROWS} label="Loading rows…" />
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
            open={verifyRows !== null}
            onOpenChange={open => !open && setVerifyRows(null)}
            table={table}
            keyColumn={keyColumn}
            rows={verifyRows ?? []}
            manualColumns={manualColumns}
          />
        )}
      </div>
    </SelectionContext.Provider>
  )
}

/**
 * A row's verification state, linking to its record page when the row needs attention: a flagged
 * row's local values and its sources' disagree, and that difference is read and resolved there
 * (take the source's values, keep ours, edit, check again), never signed off from a list. A table
 * with no single-key record page shows the plain icon — there is nowhere to send the admin.
 */
function VerificationIcon({ table, row }: { table: string; row: Row }) {
  const openTo = needsAttention(row) ? recordPath(table, row) : undefined
  const icon = <VerificationStatusIcon row={row} />
  return openTo
    ? <Link to={openTo} className="inline-flex items-center rounded-md p-1 hover:bg-gray-100">{icon}</Link>
    : icon
}

/**
 * One cell of a raw row. A column the panel can say something better about — another record's key,
 * an instant — is shown through columnValue, which the record page shares, so a row reads the same
 * in the list as it does opened. Anything else is the API's own value, truncated to keep the grid
 * legible, with the whole of it in the title.
 */
function Cell({ column, value, row }: { column: string; value: unknown; row: Row }) {
  if (value === MASKED) return <MaskedBadge />
  if (value === null || value === undefined) return <span className="text-gray-400">—</span>
  const better = columnValue(column, value, row)
  if (better) return <span className="block max-w-xs truncate" title={better.title}>{better.node}</span>
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  return <span className="block max-w-xs truncate" title={text}>{text}</span>
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

const SELECT_CLASS = 'h-10 rounded-md border border-gray-200 bg-white px-3 text-sm'
// The only two values the API parses for a Bool column, offered rather than spelled out in a hint.
const BOOL_VALUES = ['true', 'false']

function FilterForm({ columns, published, filter, onApply, onClear }: {
  columns: string[]
  published: BrowsableColumnDto[] | null | undefined
  filter: string | undefined
  onApply: (filter: string) => void
  onClear: () => void
}) {
  // The API splits on the first ':' only, so a value may itself contain colons.
  const separator = filter?.indexOf(':') ?? -1
  const appliedColumn = separator >= 0 ? filter!.slice(0, separator) : ''
  const appliedValue = separator >= 0 ? filter!.slice(separator + 1) : ''

  const [column, setColumn] = useState(appliedColumn)
  const [value, setValue] = useState(appliedValue.replace(/^>=/, ''))
  // ">=" is the API's only operator, and dates its only operand (#334). Applied filters keep
  // whichever the URL carries; a fresh date filter leads with "on or after", since an exact match
  // on a stored timestamp almost never matches the day an admin picks.
  // Only an applied filter that names an exact value selects "exactly"; with nothing applied the
  // default leads, the same as after the column picker changes.
  const [comparison, setComparison] = useState(appliedValue !== '' && !appliedValue.startsWith('>=') ? 'exact' : 'gte')

  const options = filterColumns(published, columns, appliedColumn || undefined)
  const chosen = column || options[0]?.name || ''
  const chosenColumn = options.find(option => option.name === chosen)
  const control = filterControl(chosenColumn?.kind)

  // A picker always has a value: whatever is typed (or carried in from the URL) if it is one of the
  // options, else the option the browser is already showing as selected.
  const picked = control === 'enum' ? chosenColumn?.values ?? [] : control === 'bool' ? BOOL_VALUES : []
  const effective = picked.length > 0 ? (picked.includes(value) ? value : picked[0]) : value
  const submitted = control === 'date' && comparison === 'gte' ? `>=${effective}` : effective

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={e => {
        e.preventDefault()
        if (chosen && effective && control !== 'none') onApply(`${chosen}:${submitted}`)
      }}
    >
      <select
        aria-label="Filter column"
        value={chosen}
        onChange={e => {
          setColumn(e.target.value)
          // The value belongs to the column it was typed for: a date left behind in an enum picker,
          // or "Pending" left in a date box, would apply as a filter nobody asked for.
          setValue('')
          setComparison('gte')
        }}
        className={SELECT_CLASS}
      >
        {options.map(option => <option key={option.name} value={option.name}>{option.name}</option>)}
      </select>

      {control === 'date' && (
        <select aria-label="Date comparison" value={comparison} onChange={e => setComparison(e.target.value)} className={SELECT_CLASS}>
          <option value="gte">On or after</option>
          <option value="exact">Exactly</option>
        </select>
      )}

      {control === 'none' ? (
        // The API said outright it cannot filter this column, so no control is offered at all — one
        // that produced a 400 on every press would be worse than none.
        <p className="text-sm text-gray-500">{"This column can't be filtered."}</p>
      ) : picked.length > 0 ? (
        <select aria-label="Filter value" value={effective} onChange={e => setValue(e.target.value)} className={SELECT_CLASS}>
          {picked.map(option => <option key={option} value={option}>{option}</option>)}
        </select>
      ) : (
        <Input
          aria-label="Filter value"
          type={control === 'date' ? 'date' : 'text'}
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder="Value"
          className="max-w-xs"
        />
      )}

      <Button type="submit" variant="outline" disabled={control === 'none'}>Apply filter</Button>
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
