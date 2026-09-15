import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { getAdminGetBrowsableTableDataQueryKey } from '@/api/generated/admin'
import { apiErrorMessage } from '@/lib/apiError'
import { cn } from '@/lib/utils'
import { lookup, VERIFIERS } from './records'
import { VerificationStatusBadge } from './VerificationStatus'
import { SourceVerifyPanel } from './SourceVerifyPanel'
import { VERIFICATION_ENTITY_TYPES } from './verificationChecks'

type Row = Record<string, unknown>

/** One dialog row's manual-verify result: in flight, verified, or a message to show inline. */
type Outcome = { status: 'pending' } | { status: 'verified' } | { status: 'error'; message: string }

/** The two ways this dialog can verify a row: by hand, or by queueing an outside source's check. */
type Mode = 'manual' | 'sources'

/**
 * Verifies a batch of already-selected rows by hand, one at a time or all at once.
 *
 * `rows` is copied into `snapshot` the moment the dialog opens, via the "adjust state while
 * rendering" pattern (comparing `open` against the previous render's value) rather than an effect,
 * so a grid refetch behind the dialog can never add, remove or reorder what's shown here. Each row's
 * outcome — verified, or a per-row error — lives in `outcomes`, keyed by its key-column value, owned
 * by this component rather than derived from the snapshot so it survives whatever else gets added
 * around it later. `generationRef` counts open/close transitions (bumped in an effect — see below)
 * so that closing mid-run — including a close forced by the caller, e.g. on navigation — and a
 * possible later reopen with a different selection can neither send a further request nor let a
 * stale write land in what's now showing.
 */
export function VerifyDialog({ open, onOpenChange, table, keyColumn, rows, manualColumns }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  table: string
  keyColumn: string
  rows: Row[]
  manualColumns: string[]
}) {
  const queryClient = useQueryClient()

  const [wasOpen, setWasOpen] = useState(open)
  const [snapshot, setSnapshot] = useState<Row[]>(rows)
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({})
  const [runningAll, setRunningAll] = useState(false)
  // Reset alongside snapshot/outcomes/runningAll on open, never on a plain mode switch: the toggle
  // below changes this directly, and that must not touch any of the manual-verify session state.
  const [mode, setMode] = useState<Mode>('manual')
  const generationRef = useRef(0)

  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setSnapshot(rows)
      setOutcomes({})
      setRunningAll(false)
      setMode('manual')
    }
  }

  const entityType = lookup(VERIFICATION_ENTITY_TYPES, table)

  // Bumped whenever `open` changes, in either direction, in an effect rather than during the render
  // above: mutating a ref while rendering is unsafe (a render can be discarded or run twice), and
  // React's docs name effects as the escape hatch for exactly this — an imperative marker with no
  // rendered output. Effects always flush before any later user-triggered event, including a click
  // inside this same dialog, so verifyOne/verifyAllShown (only ever called from such a click) always
  // read a ref that's already current for the render that's actually on screen — this key change is
  // never observed mid-flight by code running inside the same render pass it happened in. `open`
  // becoming false covers a caller-forced close (e.g. DataBrowserPage closing this dialog on a view
  // change) the same way it covers this dialog's own Close button, Escape or an overlay click, since
  // all of those already reach this component only via the `open` prop changing.
  //
  // The cleanup bumps it too. When the new table isn't verifiable (e.g. airports → flight-statuses),
  // `verifier` turns falsy in the same render pass that the table changes, so DataBrowserPage drops
  // `<VerifyDialog>` from its JSX outright — this component unmounts without ever being re-rendered
  // with open=false, so the effect body above never runs again to bump it. The cleanup is the one
  // hook React still guarantees on unmount, so it's what ends an in-flight run in that case. Two
  // bumps for one ordinary open/close toggle (the old effect's cleanup, then the new effect's body)
  // are harmless: every comparison against this ref only ever checks equality, never a specific value.
  useEffect(() => {
    generationRef.current += 1
    return () => {
      generationRef.current += 1
    }
  }, [open])

  // The key column first, then the checked/default-visible columns DataBrowserPage computed, then
  // Status. manualColumns already contains the key column for a table whose checks include it
  // (countries' Code), so it is never listed twice.
  const columns = [keyColumn, ...manualColumns.filter(name => name !== keyColumn), 'Status']

  const isVerified = (row: Row) => row.IsVerified === true || outcomes[String(row[keyColumn])]?.status === 'verified'
  const isPending = (row: Row) => outcomes[String(row[keyColumn])]?.status === 'pending'
  // A pending row doesn't count as remaining either: it already has a request in flight, whether
  // from its own button or from a bulk run, and Verify all shown must not send it a second one.
  const remaining = snapshot.filter(row => !isVerified(row) && !isPending(row)).length

  async function verifyOne(row: Row) {
    const generation = generationRef.current
    const key = String(row[keyColumn])
    // Only applies the outcome while it's still this same open dialog session — see the
    // class-level comment on `generationRef`.
    const applyOutcome = (outcome: Outcome) => {
      if (generationRef.current === generation) setOutcomes(prev => ({ ...prev, [key]: outcome }))
    }
    applyOutcome({ status: 'pending' })
    try {
      // Only ever called for a verifiable table (the toolbar button that opens this dialog only
      // exists where lookup(VERIFIERS, table) is defined), so this always finds a verifier.
      await lookup(VERIFIERS, table)!(key, { isVerified: true })
      applyOutcome({ status: 'verified' })
      // The row really did change server-side, so the grid should refresh regardless of whether
      // this dialog is still open, or has since been closed (or closed and reopened).
      void queryClient.invalidateQueries({ queryKey: getAdminGetBrowsableTableDataQueryKey(table) })
    } catch (error) {
      // Matches the grid's own verify: the API answers a missing row with an empty 404.
      const status = (error as { response?: { status?: number } } | null)?.response?.status
      const message = status === 404 ? 'it no longer exists' : apiErrorMessage(error).title
      applyOutcome({ status: 'error', message })
    }
  }

  // Skips already-verified and already-in-flight rows, sends one request at a time in list order,
  // and continues past a failure (verifyOne catches its own error rather than throwing). Re-checks
  // the generation before every row so closing the dialog lets the in-flight request finish — its
  // own outcome write is what the generation check inside verifyOne guards — but starts no more.
  async function verifyAllShown() {
    const generation = generationRef.current
    setRunningAll(true)
    for (const row of snapshot) {
      if (generationRef.current !== generation) break
      if (isVerified(row) || isPending(row)) continue
      await verifyOne(row)
    }
    if (generationRef.current === generation) setRunningAll(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col">
        <DialogHeader>
          <DialogTitle>{`Verify ${snapshot.length} selected ${snapshot.length === 1 ? 'row' : 'rows'}`}</DialogTitle>
          <DialogDescription>Verify rows by hand, one at a time or all at once.</DialogDescription>
        </DialogHeader>

        {/* Only the three tables an outside source can check get a choice at all; the other five
            keep the plain Manually list they've always had. Follows the Verified filter group's own
            pressed-button pattern immediately below in the DOM. */}
        {entityType && (
          <div role="group" aria-label="Verify how" className="inline-flex w-fit overflow-hidden rounded-md border border-gray-200">
            {(['manual', 'sources'] as const).map(option => (
              <button
                key={option}
                type="button"
                aria-pressed={mode === option}
                onClick={() => setMode(option)}
                className={cn('px-3 py-1.5 text-sm', mode === option ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50')}
              >
                {option === 'manual' ? 'Manually' : 'Against sources'}
              </button>
            ))}
          </div>
        )}

        {mode === 'sources' && entityType ? (
          // Same scroll cap as the Manually table below, so the header (title + mode toggle) and
          // the footer's Close button stay on screen regardless of how many sources or how long the
          // cost/queue text gets. jsdom can't lay this out, so it has no test — check in a browser.
          <div className="min-h-0 flex-1 overflow-auto">
            <SourceVerifyPanel entityType={entityType} keys={snapshot.map(row => String(row[keyColumn]))} />
          </div>
        ) : (
          <>
            <div className="flex justify-end">
              <Button type="button" variant="outline" size="sm" disabled={runningAll || remaining === 0} onClick={() => void verifyAllShown()}>
                Verify all shown
              </Button>
            </div>

            {/* Caps the dialog at 90% of the viewport and lets only this middle section scroll, so a
                selection long enough to overflow the screen still keeps the title/Verify-all-shown
                above and Close below on screen. jsdom can't lay this out, so it has no test — check in
                a browser. */}
            <div className="min-h-0 flex-1 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {columns.map(name => <TableHead key={name}>{name}</TableHead>)}
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {snapshot.map(row => {
                    const key = String(row[keyColumn])
                    const outcome = outcomes[key]
                    const verified = isVerified(row)
                    // Only a row this dialog actually verified gets the manual stamp; a row that arrived
                    // already verified keeps its own VerificationSource so the badge doesn't misattribute it.
                    const displayRow = outcome?.status === 'verified' ? { ...row, IsVerified: true, VerificationSource: 'manual', VerificationIssue: null } : row
                    return (
                      <TableRow key={key}>
                        {columns.map(name => (
                          <TableCell key={name}>
                            {name === 'Status' ? <VerificationStatusBadge row={displayRow} /> : <CellValue value={row[name]} />}
                          </TableCell>
                        ))}
                        <TableCell>
                          {!verified && (
                            <div className="space-y-1">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={runningAll || outcome?.status === 'pending'}
                                onClick={() => void verifyOne(row)}
                              >
                                Verify
                              </Button>
                              {outcome?.status === 'error' && (
                                <p className="text-xs text-red-600">{`Couldn't verify: ${outcome.message}`}</p>
                              )}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CellValue({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === '') return <span className="text-gray-400">—</span>
  return <span>{String(value)}</span>
}
