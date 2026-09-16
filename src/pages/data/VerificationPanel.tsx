import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  adminListVerificationSources, adminQueueVerificationRequests,
  getAdminGetBrowsableTableDataQueryKey, getAdminGetVerificationNeedsAttentionQueryKey,
  getAdminListVerificationRequestsQueryKey, useAdminAcceptVerificationSource, useAdminListVerificationRequests,
} from '@/api/generated/admin'
import type { VerificationRequestDto } from '@/api/generated/model'
import { apiErrorMessage } from '@/lib/apiError'
import { formatUtcMinute } from '@/lib/formatUtc'
import { lookup, VERIFIERS } from './records'
import { verificationState } from './verificationState'
import { VerificationStatusBadge } from './VerificationStatus'

type Row = Record<string, unknown>
type EntityType = 'Airport' | 'Airline' | 'Country'

const text = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** A string, filtered out of a possibly-null/undefined array of possibly-null strings. */
const definedStrings = (values: readonly (string | null | undefined)[] | null | undefined): string[] =>
  (values ?? []).filter((v): v is string => text(v) !== undefined)

/**
 * The record page's verification section: always the row's status, and — for a checkable table
 * (`entityType` set) whose row needs attention — the latest automated check's differences or
 * error, with the actions to resolve it. The other five verifiable tables (and a checkable table's
 * verified or never-checked row) get only the status line and the plain Verify/Unverify toggle,
 * since there is never a check to show (spec §8; the automated job only ever touches Airport,
 * Airline and Country rows).
 *
 * Fetches sparingly: GET /admin/verification-requests?limit=1 runs only when both `entityType` is
 * set and the row needs attention — a verified or never-checked row, or a table with no outside
 * source, sends no request at all, since there would be nothing useful to show for one. The row's
 * own state is owned by the record page, not here: every action below only invalidates the raw
 * table and the needs-attention counts, and lets the next render pick up the refetched row, rather
 * than tracking a local copy of it.
 */
export function VerificationPanel({ table, entityType, recordKey, row, onEdit }: {
  table: string
  entityType: EntityType | undefined
  recordKey: string
  row: Row
  // Undefined when the table has no edit form (e.g. countries): a button that cannot do anything
  // must not be shown, so RecordPage only supplies this when there's somewhere for it to go.
  onEdit?: () => void
}) {
  const queryClient = useQueryClient()
  const state = verificationState(row)
  const needsAttention = state.issue !== undefined
  // Both must hold: a checkable type, and a row that actually needs attention.
  const fetchChecks = entityType !== undefined && needsAttention

  const checksParams = { entityType, entityKey: recordKey, limit: 1 }
  const checks = useAdminListVerificationRequests(checksParams, { query: { enabled: fetchChecks } })
  const check = checks.data?.[0]

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: getAdminGetBrowsableTableDataQueryKey(table) })
    void queryClient.invalidateQueries({ queryKey: getAdminGetVerificationNeedsAttentionQueryKey() })
  }

  const verify = useMutation({
    // Only ever invoked where a verifier is guaranteed (RecordPage renders this panel only then).
    mutationFn: (isVerified: boolean) => lookup(VERIFIERS, table)!(recordKey, { isVerified }),
    onSuccess: refresh,
  })

  const acceptSource = useAdminAcceptVerificationSource({ mutation: { onSuccess: refresh } })

  const checkAgain = useMutation({
    // Re-checks with the sources that check actually used; only when it names none does this ask
    // the sources endpoint instead, so a re-check never silently drops a source that last ran.
    mutationFn: async () => {
      const named = definedStrings(check?.sources)
      const sources = named.length > 0
        ? named
        : definedStrings((await adminListVerificationSources({ entityType })).map(s => s.name))
      return adminQueueVerificationRequests({ entityType, keys: [recordKey], sources })
    },
    onSuccess: () => {
      refresh()
      // Its own read query: re-fetch so a Pending row shows up without waiting for a navigation.
      void queryClient.invalidateQueries({ queryKey: getAdminListVerificationRequestsQueryKey(checksParams) })
    },
  })

  const verifiedAt = text(row.VerifiedAt)

  return (
    <Card>
      <CardContent className="space-y-4 p-4 text-sm">
        <div className="flex flex-wrap items-center gap-3">
          <VerificationStatusBadge row={row} />
          {!fetchChecks && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={verify.isPending}
              onClick={() => verify.mutate(row.IsVerified !== true)}
            >
              {row.IsVerified === true ? 'Unverify' : 'Verify'}
            </Button>
          )}
        </div>

        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-3">
          <Field label="Source" value={text(row.VerificationSource)} />
          <Field label="Verified at" value={verifiedAt ? `${formatUtcMinute(verifiedAt)} UTC` : undefined} />
          <Field label="Verified by" value={text(row.VerifiedBy)} />
        </dl>

        {/* The plain toggle's own error. When fetchChecks is true this same mutation backs "Keep ours
            and verify" instead, whose error NeedsAttention shows itself — showing it here too would
            duplicate it. */}
        {!fetchChecks && verify.error && (
          <ErrorAlert text={`Couldn't ${verify.variables ? 'verify' : 'unverify'} this record`} error={verify.error} />
        )}

        {fetchChecks && entityType && (
          <NeedsAttention
            issue={state.issue}
            loading={checks.isLoading}
            loadError={checks.error}
            check={check}
            entityType={entityType}
            onEdit={onEdit}
            onKeepOursAndVerify={() => verify.mutate(true)}
            keepPending={verify.isPending}
            keepError={verify.error}
            onTakeSource={source => acceptSource.mutate({ id: check!.id!, data: { source } })}
            takePending={acceptSource.isPending}
            takeError={acceptSource.error}
            onCheckAgain={() => checkAgain.mutate()}
            checkAgainPending={checkAgain.isPending}
            checkAgainError={checkAgain.error}
          />
        )}
      </CardContent>
    </Card>
  )
}

function Field({ label, value }: { label: string; value: string | undefined }) {
  return (
    <div>
      <dt className="text-gray-500">{label}</dt>
      <dd className="mt-0.5 text-gray-900">{value ?? '—'}</dd>
    </div>
  )
}

function ErrorAlert({ text, error }: { text: string; error: unknown }) {
  return <ErrorAlertMessage label={text} message={apiErrorMessage(error)} />
}

function ErrorAlertMessage({ label, message: { title, detail } }: { label: string; message: { title: string; detail?: string } }) {
  return (
    <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
      <p>{`${label}: ${title}`}</p>
      {detail && <p className="mt-1 text-red-600">{detail}</p>}
    </div>
  )
}

/**
 * A 409 from accept-source: the title is reworded to name the two most likely causes rather than
 * showing the raw ProblemDetails title, but `detail` — the line saying which of the four the API
 * actually hit, rendered outside Production — still comes through unchanged.
 */
function acceptSourceErrorMessage(error: unknown): { title: string; detail?: string } {
  const status = (error as { response?: { status?: number } } | null)?.response?.status
  if (status === 409) return { title: 'This row changed, or a check is already running', detail: apiErrorMessage(error).detail }
  return apiErrorMessage(error)
}

/**
 * The needs-attention block: what the latest check (fetched by the parent) shows, by its status.
 * Takes every mutation's state as props rather than owning them, since they're shared with the
 * plain Verify/Unverify toggle above (the same verify route) and must disable together.
 */
function NeedsAttention({
  issue, loading, loadError, check, entityType, onEdit,
  onKeepOursAndVerify, keepPending, keepError,
  onTakeSource, takePending, takeError,
  onCheckAgain, checkAgainPending, checkAgainError,
}: {
  issue: string | undefined
  loading: boolean
  loadError: unknown
  check: VerificationRequestDto | undefined
  entityType: EntityType
  onEdit?: () => void
  onKeepOursAndVerify: () => void
  keepPending: boolean
  keepError: unknown
  onTakeSource: (source: string) => void
  takePending: boolean
  takeError: unknown
  onCheckAgain: () => void
  checkAgainPending: boolean
  checkAgainError: unknown
}) {
  if (loading) return <p className="text-xs text-gray-400">Checking the latest verification…</p>
  if (loadError) return <ErrorAlert text="Couldn't load the latest verification check" error={loadError} />

  const keepOursButton = (
    <Button type="button" variant="outline" size="sm" disabled={keepPending} onClick={onKeepOursAndVerify}>
      Keep ours and verify
    </Button>
  )
  // Undefined (never null) when the table has no edit form; a falsy onEdit renders no button at
  // all, rather than one that changes the URL and does nothing.
  const editButton = onEdit && (
    <Button type="button" variant="outline" size="sm" onClick={onEdit}>Edit</Button>
  )
  const checkAgainButton = (
    <Button type="button" variant="outline" size="sm" disabled={checkAgainPending} onClick={onCheckAgain}>
      Check again
    </Button>
  )
  const keepErrorAlert = Boolean(keepError) && <ErrorAlert text="Couldn't verify this record" error={keepError} />
  const checkAgainErrorAlert = Boolean(checkAgainError) && <ErrorAlert text="Couldn't queue a new check" error={checkAgainError} />

  // The issue text plus Keep ours and verify / Check again: what "no check on file" shows, and
  // also what a Mismatch with no actual differences falls back to below — there's nothing to
  // compare or take either way.
  const noCheckFallback = (
    <div className="space-y-3">
      <p className="text-gray-700">{issue}</p>
      <div className="flex flex-wrap gap-2">{keepOursButton}{checkAgainButton}</div>
      {keepErrorAlert}
      {checkAgainErrorAlert}
    </div>
  )

  if (!check) {
    // The job set an issue but left no check row to explain it; kept simple since it should be
    // rare in practice (the job that leaves an issue also always leaves a check behind it).
    return noCheckFallback
  }

  if (check.status === 'Pending' || check.status === 'Running') {
    return <p className="text-gray-500">A check is running.</p>
  }

  if (check.status === 'Error') {
    return (
      <div className="space-y-3">
        <p className="text-red-700">{check.error ?? 'The check failed.'}</p>
        <div className="flex flex-wrap gap-2">{checkAgainButton}</div>
        {checkAgainErrorAlert}
      </div>
    )
  }

  if (check.status === 'Mismatch') {
    const differences = check.differences ?? []
    // A Mismatch should always carry at least one difference; if it somehow doesn't there is
    // nothing to compare or take, so this falls back to the same rendering as "no check on file".
    if (differences.length === 0) return noCheckFallback

    const columns = [...new Set(differences.map(d => d.column).filter((c): c is string => text(c) !== undefined))]
    // Preserves first-seen order, and pairs each source's key with the display name its own
    // entries carry (falling back to the key when the API ever omits sourceName).
    const sourceNames = new Map<string, string>()
    for (const d of differences) {
      if (text(d.source) && !sourceNames.has(d.source!)) sourceNames.set(d.source!, text(d.sourceName) ?? d.source!)
    }
    const sources = [...sourceNames.keys()]
    // text() first so an empty string reads as "—" the same way a null does, like every other
    // field in this panel — not a blank cell.
    const oursFor = (column: string) => text(differences.find(d => d.column === column)?.ours) ?? '—'
    const valueFor = (source: string, column: string) => text(check.sourceValues?.[source]?.[column]) ?? '—'

    return (
      <div className="space-y-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Column</TableHead>
              <TableHead>Ours</TableHead>
              {sources.map(source => <TableHead key={source}>{sourceNames.get(source)}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {columns.map(column => (
              <TableRow key={column}>
                <TableCell className="font-medium">{column}</TableCell>
                <TableCell>{oursFor(column)}</TableCell>
                {sources.map(source => <TableCell key={source}>{valueFor(source, column)}</TableCell>)}
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div className="flex flex-wrap gap-2">
          {sources.map(source => (
            <Button
              key={source}
              type="button"
              variant="outline"
              size="sm"
              disabled={takePending}
              onClick={() => onTakeSource(source)}
            >
              {/* The literal label almost always applies (today, a check has one source in nearly
                  every case); the per-source form only earns its place once there are actually
                  two-or-more buttons that would otherwise be indistinguishable. */}
              {sources.length > 1 ? `Take ${sourceNames.get(source)} values` : 'Take source values'}
            </Button>
          ))}
          {keepOursButton}
          {editButton}
          {checkAgainButton}
        </div>
        {Boolean(takeError) && <ErrorAlertMessage label="Couldn't take those values" message={acceptSourceErrorMessage(takeError)} />}
        {keepErrorAlert}
        {checkAgainErrorAlert}
      </div>
    )
  }

  if (check.status === 'NotFound') {
    const sources = definedStrings(check.sources)
    return (
      <div className="space-y-3">
        <p className="text-gray-700">{`No matching ${entityType.toLowerCase()} row for at least one source.`}</p>
        <dl className="space-y-2">
          {sources.map(source => {
            const values = check.sourceValues?.[source]
            const entries = values ? Object.entries(values) : []
            return (
              <div key={source}>
                <dt className="font-medium text-gray-900">{source}</dt>
                <dd className="text-gray-700">
                  {entries.length > 0 ? entries.map(([column, value]) => `${column}: ${value}`).join(' · ') : 'No data returned'}
                </dd>
              </div>
            )
          })}
        </dl>
        <div className="flex flex-wrap gap-2">{keepOursButton}{editButton}{checkAgainButton}</div>
        {keepErrorAlert}
        {checkAgainErrorAlert}
      </div>
    )
  }

  // Any other status (e.g. Verified, which shouldn't coexist with an unresolved issue) degrades to
  // a safe, re-checkable fallback rather than rendering nothing.
  return (
    <div className="space-y-3">
      <p className="text-gray-500">{`Latest check: ${check.status ?? 'unknown'}.`}</p>
      <div className="flex flex-wrap gap-2">{checkAgainButton}</div>
      {checkAgainErrorAlert}
    </div>
  )
}
