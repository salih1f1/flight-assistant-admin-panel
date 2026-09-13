import { Fragment, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { keepPreviousData } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { MaskedBadge } from '@/components/RevealableValue'
import { useAdminGetAuditLog } from '@/api/generated/admin'
import type { AdminAuditAction, AdminAuditDto } from '@/api/generated/model'
import { apiErrorMessage } from '@/lib/apiError'
import { formatUtcMinute } from '@/lib/formatUtc'

const PAGE_SIZE = 50

// AdminAuditAction in declaration order: the API takes the action filter as this index.
const ACTIONS = ['Create', 'Update', 'Delete', 'Verify', 'Import', 'Reveal'] as const

// SensitiveProperties.RedactedPlaceholder: the audit log stores sensitive values masked.
const MASKED = '<redacted>'

// Entity types (CLR names, as the audit rows carry them) the panel has a page for.
const ENTITY_PAGES: Record<string, (id: string) => string> = {
  Traveler: id => `/travelers/${id}`,
  Flight: id => `/flights/${id}`,
  Airline: id => `/airlines/${id}/edit`,
  Airport: id => `/airports/${id}/edit`,
  Lounge: id => `/lounges/${id}/edit`,
  LoyaltyProgram: id => `/loyalty/${id}/edit`,
}

const FILTERS = ['action', 'entityType', 'entityId', 'actorId', 'from', 'to'] as const
type Filters = Record<(typeof FILTERS)[number], string>

const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)

/**
 * The admin audit log (GET /admin/audit): one row per admin write or reveal, newest first.
 * Filters live in the URL so a view can be shared. Dates are whole UTC days, both ends included:
 * the API reads a bare date as midnight, so "to" is sent as the end of that day.
 */
export function AuditLogPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const page = Math.max(1, Number(searchParams.get('page')) || 1)
  const filters = Object.fromEntries(FILTERS.map(key => [key, searchParams.get(key) ?? ''])) as Filters
  const actionIndex = ACTIONS.indexOf(filters.action as (typeof ACTIONS)[number])

  const { data, isLoading, error } = useAdminGetAuditLog(
    {
      Page: page,
      PageSize: PAGE_SIZE,
      action: actionIndex >= 0 ? (actionIndex as AdminAuditAction) : undefined,
      entityType: filters.entityType || undefined,
      entityId: filters.entityId || undefined,
      actorId: filters.actorId || undefined,
      fromUtc: isDate(filters.from) ? `${filters.from}T00:00:00Z` : undefined,
      toUtc: isDate(filters.to) ? `${filters.to}T23:59:59.999Z` : undefined,
    },
    { query: { placeholderData: keepPreviousData } },
  )

  const applyFilters = (next: Filters) => {
    const params = new URLSearchParams()
    for (const key of FILTERS) if (next[key]) params.set(key, next[key])
    setSearchParams(params)
  }

  const goToPage = (next: number) => {
    const params = new URLSearchParams(searchParams)
    if (next > 1) params.set('page', String(next))
    else params.delete('page')
    setSearchParams(params)
  }

  const rows = data?.items ?? []
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Audit log</h1>
        <p className="text-sm text-gray-500">Every admin create, update, delete, verify, import and reveal, newest first.</p>
      </div>

      <FilterForm key={searchParams.toString()} filters={filters} onApply={applyFilters} onClear={() => setSearchParams({})} />

      {error ? (
        <ErrorAlert error={error} />
      ) : isLoading ? (
        <p className="text-gray-400">Loading…</p>
      ) : (
        <Card>
          <CardContent className="space-y-4 pt-6">
            {rows.length === 0 ? (
              <p className="text-sm text-gray-500">No audit rows match.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Who</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Entity</TableHead>
                      <TableHead>Summary</TableHead>
                      <TableHead><span className="sr-only">Changes</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map(row => <AuditRow key={row.id} row={row} />)}
                  </TableBody>
                </Table>
              </div>
            )}
            <div className="flex items-center justify-between text-sm text-gray-500">
              <span>{`Page ${page} of ${pageCount} · ${total} total`}</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => goToPage(page - 1)} disabled={page <= 1}>Previous</Button>
                <Button variant="outline" size="sm" onClick={() => goToPage(page + 1)} disabled={page >= pageCount}>Next</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function AuditRow({ row }: { row: AdminAuditDto }) {
  const [open, setOpen] = useState(false)
  const entityLabel = `${row.entityType ?? 'Unknown'} ${row.entityId ?? '(pending id)'}`
  const pageFor = row.entityType ? ENTITY_PAGES[row.entityType] : undefined
  const hasChanges = row.before != null || row.after != null

  return (
    <Fragment>
      <TableRow>
        <TableCell className="whitespace-nowrap">{row.actionUtc ? `${formatUtcMinute(row.actionUtc)} UTC` : '—'}</TableCell>
        <TableCell>{row.actorName ?? row.actorId ?? '—'}</TableCell>
        <TableCell>{row.action ?? '—'}</TableCell>
        <TableCell>
          {pageFor && row.entityId ? <Link to={pageFor(row.entityId)} className="underline">{entityLabel}</Link> : entityLabel}
        </TableCell>
        <TableCell>{row.summary ?? '—'}</TableCell>
        <TableCell className="text-right">
          {row.action === 'Reveal' ? (
            // RevealValueCommand never writes the value, only which column was revealed.
            <span className="text-xs text-gray-400">Value not logged</span>
          ) : hasChanges ? (
            <Button variant="ghost" size="sm" onClick={() => setOpen(o => !o)}>{open ? 'Hide changes' : 'Show changes'}</Button>
          ) : null}
        </TableCell>
      </TableRow>
      {open && hasChanges && (
        <TableRow>
          <TableCell colSpan={6} className="bg-gray-50">
            <Changes label={entityLabel} before={row.before} after={row.after} />
          </TableCell>
        </TableRow>
      )}
    </Fragment>
  )
}

/** Before and After per property. An update lists only what changed; a create has only After, a delete only Before. */
function Changes({ label, before, after }: { label: string; before: unknown; after: unknown }) {
  const beforeValues = asRecord(before)
  const afterValues = asRecord(after)
  const properties = [...new Set([...Object.keys(beforeValues), ...Object.keys(afterValues)])]

  return (
    <table aria-label={`Changes to ${label}`} className="w-full text-sm">
      <thead>
        <tr className="text-left text-gray-500">
          <th className="py-1 pr-4 font-medium">Property</th>
          <th className="py-1 pr-4 font-medium">Before</th>
          <th className="py-1 font-medium">After</th>
        </tr>
      </thead>
      <tbody>
        {properties.map(property => (
          <tr key={property} className="align-top">
            <td className="py-1 pr-4 font-mono text-xs">{property}</td>
            <td className="py-1 pr-4"><Value value={beforeValues[property]} /></td>
            <td className="py-1"><Value value={afterValues[property]} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

function Value({ value }: { value: unknown }) {
  if (value === MASKED) return <MaskedBadge />
  if (value === null || value === undefined) return <span className="text-gray-400">—</span>
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  return <span className="break-all">{text}</span>
}

function FilterForm({ filters, onApply, onClear }: { filters: Filters; onApply: (filters: Filters) => void; onClear: () => void }) {
  const [draft, setDraft] = useState(filters)
  const set = (key: keyof Filters) => (e: { target: { value: string } }) => setDraft(d => ({ ...d, [key]: e.target.value }))
  const anyApplied = FILTERS.some(key => filters[key])

  return (
    <form
      className="grid grid-cols-1 gap-3 rounded-md border border-gray-200 bg-white p-4 sm:grid-cols-3"
      onSubmit={e => {
        e.preventDefault()
        onApply(draft)
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="audit-action">Action</Label>
        <select
          id="audit-action"
          value={draft.action}
          onChange={set('action')}
          className="flex h-10 w-full rounded-md border border-gray-200 bg-white px-3 text-sm"
        >
          <option value="">Any action</option>
          {ACTIONS.map(action => <option key={action} value={action}>{action}</option>)}
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="audit-entity-type">Entity type</Label>
        <Input id="audit-entity-type" value={draft.entityType} onChange={set('entityType')} placeholder="e.g. Airline (exact, case-sensitive)" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="audit-entity-id">Entity id</Label>
        <Input id="audit-entity-id" value={draft.entityId} onChange={set('entityId')} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="audit-actor-id">Actor id</Label>
        <Input id="audit-actor-id" value={draft.actorId} onChange={set('actorId')} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="audit-from">From</Label>
        <Input id="audit-from" type="date" value={draft.from} onChange={set('from')} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="audit-to">To</Label>
        <Input id="audit-to" type="date" value={draft.to} onChange={set('to')} />
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:col-span-3">
        <Button type="submit">Apply filters</Button>
        {anyApplied && <Button type="button" variant="outline" onClick={onClear}>Clear filters</Button>}
        <span className="text-xs text-gray-500">Dates are whole UTC days, both ends included.</span>
      </div>
    </form>
  )
}

function ErrorAlert({ error }: { error: unknown }) {
  const { title, detail } = apiErrorMessage(error)
  return (
    <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      <p>{`Could not load the audit log: ${title}`}</p>
      {detail && <p className="mt-1 text-xs text-red-600">{detail}</p>}
    </div>
  )
}
