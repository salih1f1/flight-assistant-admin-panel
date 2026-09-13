import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type ColumnDef } from '@tanstack/react-table'
import { EyeOff, Lock } from 'lucide-react'
import { DataTable } from '@/components/DataTable'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  adminVerifyAirline, adminVerifyAirport, adminVerifyAlliance, adminVerifyCountry, adminVerifyLounge,
  adminVerifyLoungeProvider, adminVerifyLoyaltyProgram, adminVerifyLoyaltyProgramKind,
  getAdminGetBrowsableTableDataQueryKey, useAdminGetBrowsableTableData, useAdminListBrowsableTables,
  useAdminRevealValue,
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

/** A masked value the admin has asked to reveal, awaiting confirmation. */
type RevealTarget = { id: string; column: string }

/**
 * The read-only data browser over GET /admin/data/{table}. Rows arrive as
 * dictionaries keyed by the entity's PascalCase column names, in the API's column
 * order; sensitive columns are already masked server-side.
 *
 * The table is in the path and page, sort and filter are in the query string, so a
 * view survives a reload and can be shared. Sort and filter column names go to the
 * API as they appear in the rows (the API matches them case-sensitively).
 *
 * A masked value can be revealed through POST /admin/data/{table}/{id}/reveal,
 * which writes an audit row before answering. Revealed values live only in this
 * page's state for the current view: never in the URL or the query cache, and gone
 * as soon as the table, page, sort or filter changes.
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

  // Revealed values belong to one view and are discarded the moment it changes, so coming
  // back to the same page later shows them masked again. Reset during render (React's
  // pattern for state that follows a changing value) rather than in an effect, so no
  // render ever shows a stale value.
  const viewKey = [table, page, sort, filter].join('|')
  const [revealed, setRevealed] = useState<{ viewKey: string; values: Record<string, unknown> }>({ viewKey, values: {} })
  if (revealed.viewKey !== viewKey) setRevealed({ viewKey, values: {} })
  const revealedValues = revealed.viewKey === viewKey ? revealed.values : {}
  const [revealTarget, setRevealTarget] = useState<RevealTarget | null>(null)
  // gcTime 0: the mutation cache must not keep a revealed value after this page lets go of it.
  const reveal = useAdminRevealValue({ mutation: { gcTime: 0 } })

  const queryClient = useQueryClient()
  const verifier = table ? VERIFIERS[table] : undefined
  const verify = useMutation({
    mutationFn: ({ table: slug, id, isVerified }: VerifyTarget) => VERIFIERS[slug](id, { isVerified }),
    // Every page, sort and filter of this table: a verified row may now fall out of an Unverified view.
    onSuccess: (_, { table: slug }) => queryClient.invalidateQueries({ queryKey: getAdminGetBrowsableTableDataQueryKey(slug) }),
  })

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

  const askToReveal = (target: RevealTarget) => {
    reveal.reset()
    setRevealTarget(target)
  }

  const cancelReveal = () => {
    reveal.reset()
    setRevealTarget(null)
  }

  const confirmReveal = () => {
    if (!table || !revealTarget) return
    const target = revealTarget
    const forView = viewKey
    reveal.mutate(
      { table, id: target.id, data: { column: target.column } },
      {
        onSuccess: result => {
          // A reveal that finishes after the view changed belongs to a view that's gone: drop it.
          setRevealed(previous => previous.viewKey === forView
            ? { viewKey: forView, values: { ...previous.values, [revealKey(target)]: result.value } }
            : previous)
          setRevealTarget(null)
          reveal.reset()
        },
      },
    )
  }

  const hide = (target: RevealTarget) =>
    setRevealed(previous => {
      const values = { ...previous.values }
      delete values[revealKey(target)]
      return { ...previous, values }
    })

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
    cell: ({ row }) => {
      const value = row.original[name]
      // Every table with a sensitive column is keyed by a single Id, which is what the reveal endpoint takes.
      const id = row.original.Id
      if (value !== MASKED || id === null || id === undefined) return <Cell value={value} />

      const target = { id: String(id), column: name }
      const key = revealKey(target)
      if (key in revealedValues) {
        return (
          <span className="inline-flex items-center gap-1">
            <span className="rounded bg-amber-50 px-1 text-amber-900">
              <Cell value={revealedValues[key]} />
            </span>
            <button type="button" aria-label={`Hide ${name}`} title="Hide" onClick={() => hide(target)} className="text-gray-400 hover:text-gray-700">
              <EyeOff className="h-3.5 w-3.5" />
            </button>
          </span>
        )
      }
      return (
        <button type="button" aria-label={`Reveal ${name}`} title="Reveal (audited)" onClick={() => askToReveal(target)}>
          <Cell value={value} />
        </button>
      )
    },
  }))

  if (verifier && table) {
    columns.push({
      id: 'verify',
      header: () => <span className="sr-only">Verify</span>,
      cell: ({ row }) => {
        const verified = row.original.IsVerified === true
        return (
          <Button
            size="sm"
            variant="outline"
            disabled={verify.isPending}
            onClick={() => verify.mutate({ table, id: Number(row.original.Id), isVerified: !verified })}
          >
            {verified ? 'Unverify' : 'Verify'}
          </Button>
        )
      },
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Data browser</h1>
        <p className="text-sm text-gray-500">Read-only. Sensitive columns are masked by the API; revealing one is audited.</p>
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
            </>
          )}
        </div>
      </div>

      <RevealDialog
        target={revealTarget}
        loading={reveal.isPending}
        error={reveal.error}
        onCancel={cancelReveal}
        onConfirm={confirmReveal}
      />
    </div>
  )
}

const revealKey = ({ id, column }: RevealTarget) => `${id}|${column}`

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

function RevealDialog({ target, loading, error, onCancel, onConfirm }: {
  target: RevealTarget | null
  loading: boolean
  error: unknown
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog open={target !== null} onOpenChange={open => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{`Reveal ${target?.column ?? 'value'}?`}</DialogTitle>
          <DialogDescription>
            {`Row ${target?.id ?? ''}. The value is shown in this view only, and the reveal is recorded in the admin audit log under your account.`}
          </DialogDescription>
        </DialogHeader>
        {error ? <RevealError error={error} /> : null}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={loading}>Cancel</Button>
          <Button onClick={onConfirm} disabled={loading}>{loading ? 'Revealing…' : 'Reveal'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RevealError({ error }: { error: unknown }) {
  // The reveal rate limiter answers with plain text rather than ProblemDetails, and its
  // Retry-After header isn't exposed over CORS, so the reason has to be said here.
  const status = (error as { response?: { status?: number } } | null)?.response?.status
  const { title, detail } = status === 429
    ? { title: 'Too many reveals in a short time.', detail: 'The API limits how often values can be revealed. Try again shortly.' }
    : apiErrorMessage(error)
  return (
    <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      <p>{title}</p>
      {detail && <p className="mt-1 text-xs text-red-600">{detail}</p>}
    </div>
  )
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
