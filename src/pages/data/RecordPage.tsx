import type { ComponentType } from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { RevealableValue } from '@/components/RevealableValue'
import { Card, CardContent } from '@/components/ui/card'
import {
  getAdminGetBrowsableTableDataQueryKey, useAdminGetBrowsableTableData, useAdminListBrowsableTables,
} from '@/api/generated/admin'
import { apiErrorMessage } from '@/lib/apiError'
import { shortId } from '@/lib/travelerId'
import { cn } from '@/lib/utils'
import { AirlineForm } from '@/pages/airlines/AirlineFormPage'
import { AirportForm } from '@/pages/airports/AirportFormPage'
import { LoungeForm } from '@/pages/lounges/LoungeFormPage'
import { LoyaltyProgramForm } from '@/pages/loyalty/LoyaltyProgramFormPage'
import { columnLabel, columnValue } from './columnValue'
import { lookup, MASKED, OWN_DETAIL_PAGES, recordKey, RELATED_VIEWS, VERIFIERS } from './records'
import { VERIFICATION_ENTITY_TYPES } from './verificationChecks'
import { VerificationPanel } from './VerificationPanel'

/** The tables the API can update, each with the form that edits one record. */
const EDIT_FORMS: Record<string, ComponentType<{ id?: number; onDone: () => void }>> = {
  airlines: AirlineForm,
  airports: AirportForm,
  lounges: LoungeForm,
  'loyalty-programs': LoyaltyProgramForm,
}

/**
 * One record of a raw table at /data/{table}/{id}: every column the API exposes, read through
 * GET /admin/data/{table} filtered on the table's key. Masked values can be revealed (audited), and
 * a verifiable record verified. A table the API can update gets a Read | Edit toggle, kept in the
 * URL as ?mode=edit, which swaps the fields for that entity's form.
 */
export function RecordPage() {
  const { table = '', id = '' } = useParams<{ table: string; id: string }>()
  const ownPage = lookup(OWN_DETAIL_PAGES, table)
  if (ownPage) return <Navigate to={ownPage(id)} replace />
  return <Record key={`${table}|${id}`} table={table} id={id} />
}

/** The old /{entity}/:id/edit links: the record, opened in Edit. */
export function RedirectToRecord({ table }: { table: string }) {
  const { id = '' } = useParams<{ id: string }>()
  return <Navigate to={`/data/${table}/${encodeURIComponent(id)}?mode=edit`} replace />
}

function Record({ table, id }: { table: string; id: string }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const key = recordKey(table)
  const tables = useAdminListBrowsableTables()
  // The key's string filter is a contains match (Countries' Code), so the exact row is picked below.
  const rows = useAdminGetBrowsableTableData(
    table,
    { Page: 1, PageSize: 50, filter: key ? [`${key}:${id}`] : undefined },
    { query: { enabled: key !== undefined } },
  )
  const verifier = lookup(VERIFIERS, table)
  const refresh = () => queryClient.invalidateQueries({ queryKey: getAdminGetBrowsableTableDataQueryKey(table) })

  const displayName = tables.data?.find(t => t.slug === table)?.displayName ?? table
  const Form = lookup(EDIT_FORMS, table)
  // A view that adds to this page rather than replacing it (RELATED_VIEWS, not OWN_DETAIL_PAGES).
  const relatedView = lookup(RELATED_VIEWS, table)?.(id)
  const editing = Form !== undefined && searchParams.get('mode') === 'edit'
  const setEditing = (edit: boolean) => {
    const next = new URLSearchParams(searchParams)
    if (edit) next.set('mode', 'edit')
    else next.delete('mode')
    setSearchParams(next)
  }

  const back = <Link to={`/data/${table}`} className="text-sm text-gray-500 hover:text-gray-900">{`Back to ${displayName}`}</Link>

  if (key === undefined) {
    return (
      <div className="space-y-6">
        {back}
        <p className="text-sm text-gray-500">{`${displayName} records can't be opened one at a time: the table has no single key.`}</p>
      </div>
    )
  }

  const row = rows.data?.items?.find(r => String(r[key]) === id)

  return (
    <div className="space-y-6">
      {back}
      {rows.error ? (
        <ErrorAlert text={`Could not load ${displayName} ${id}`} error={rows.error} />
      ) : rows.isLoading || tables.isLoading ? (
        <p className="text-gray-400">Loading…</p>
      ) : !row ? (
        <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {`No ${displayName} record with ${key} ${id}.`}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{String(row.Name ?? row.DisplayName ?? row.Code ?? `${displayName} #${shortId(id)}`)}</h1>
              <p className="text-sm text-gray-500">{`${displayName} · ${key} ${id}`}</p>
            </div>
            <div className="flex items-center gap-2">
              {relatedView && (
                <Link to={relatedView.to} className="text-sm text-blue-600 hover:underline">
                  {relatedView.label}
                </Link>
              )}
              {Form && (
                <div role="group" aria-label="Mode" className="inline-flex overflow-hidden rounded-md border border-gray-200">
                  {[{ label: 'Read', edit: false }, { label: 'Edit', edit: true }].map(option => (
                    <button
                      key={option.label}
                      type="button"
                      aria-pressed={editing === option.edit}
                      onClick={() => setEditing(option.edit)}
                      className={cn('px-3 py-1.5 text-sm', editing === option.edit ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50')}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {verifier && 'IsVerified' in row && (
            <VerificationPanel
              table={table}
              entityType={lookup(VERIFICATION_ENTITY_TYPES, table)}
              recordKey={id}
              row={row}
              // Only when this table actually has a form to switch into (e.g. not countries) —
              // otherwise Edit would change the URL to ?mode=edit and show nothing.
              onEdit={Form ? () => setEditing(true) : undefined}
            />
          )}

          {editing && Form ? (
            <div className="max-w-xl">
              <Form
                id={Number(id)}
                onDone={() => {
                  // The form refreshes its entity's typed caches; the fields here come from the raw table.
                  void refresh()
                  setEditing(false)
                }}
              />
            </div>
          ) : (
            <Card>
              <CardContent className="p-6">
                <dl className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
                  {Object.entries(row).map(([column, value]) => (
                    <div key={column} className="min-w-0">
                      <dt className="text-xs font-medium text-gray-500">{columnLabel(column)}</dt>
                      <dd className="mt-1 break-words text-gray-900">
                        <FieldValue table={table} id={id} column={column} value={value} row={row} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

function FieldValue({ table, id, column, value, row }: {
  table: string; id: string; column: string; value: unknown; row: Record<string, unknown>
}) {
  if (value === MASKED) return <RevealableValue key={`${table}|${id}|${column}`} table={table} id={id} column={column} />
  if (value === null || value === undefined) return <span className="text-gray-400">—</span>
  // A referenced record by name, or an instant to the minute: the same rendering the grid uses.
  const better = columnValue(column, value, row)
  if (better) return <span title={better.title}>{better.node}</span>
  if (typeof value === 'boolean') return <>{value ? 'Yes' : 'No'}</>
  if (typeof value === 'object') return <code className="text-xs">{JSON.stringify(value)}</code>
  return <>{String(value)}</>
}

function ErrorAlert({ text, error }: { text: string; error: unknown }) {
  const { title, detail } = apiErrorMessage(error)
  return (
    <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      <p>{`${text}: ${title}`}</p>
      {detail && <p className="mt-1 text-xs text-red-600">{detail}</p>}
    </div>
  )
}
