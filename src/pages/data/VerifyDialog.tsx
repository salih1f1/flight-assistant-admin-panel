import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { getAdminGetBrowsableTableDataQueryKey } from '@/api/generated/admin'
import { apiErrorMessage } from '@/lib/apiError'
import { lookup, VERIFIERS } from './records'
import { VerificationStatusBadge } from './VerificationStatus'

type Row = Record<string, unknown>

/** One dialog row's manual-verify result: nothing yet, in flight, verified, or a message to show inline. */
type Outcome = { status: 'pending' } | { status: 'verified' } | { status: 'error'; message: string }

/**
 * Verifies a batch of already-selected rows. Radix Dialog; today it only offers the Manually path
 * (R4's Against-sources mode toggle is a later step and isn't rendered here).
 *
 * R5: `rows` is copied into `snapshot` the moment the dialog opens, via the "adjust state while
 * rendering" pattern (comparing `open` against the previous render's value) rather than an effect,
 * so a grid refetch behind the dialog can never add, remove or reorder what's shown here. Each
 * row's outcome — verified, or a per-row error — lives in `outcomes`, keyed by its key column value,
 * so it survives the eventual mode toggle (R4/R5) without depending on the snapshot being mutable.
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

  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setSnapshot(rows)
      setOutcomes({})
    }
  }

  // R6: the key column first, then the checked/default-visible columns DataBrowserPage computed,
  // then Status. manualColumns already contains the key column for a table whose §3 checks include
  // it (countries' Code), so it is never listed twice.
  const columns = [keyColumn, ...manualColumns.filter(name => name !== keyColumn), 'Status']

  const isVerified = (row: Row) => row.IsVerified === true || outcomes[String(row[keyColumn])]?.status === 'verified'
  const remaining = snapshot.filter(row => !isVerified(row)).length

  async function verifyOne(row: Row) {
    const key = String(row[keyColumn])
    setOutcomes(prev => ({ ...prev, [key]: { status: 'pending' } }))
    try {
      // Only ever called for a verifiable table (the toolbar button that opens this dialog only
      // exists where lookup(VERIFIERS, table) is defined), so this always finds a verifier.
      await lookup(VERIFIERS, table)!(key, { isVerified: true })
      setOutcomes(prev => ({ ...prev, [key]: { status: 'verified' } }))
      // R10: invalidate so the grid behind the dialog refreshes; the snapshot above is what keeps
      // that refetch from touching what this dialog shows.
      void queryClient.invalidateQueries({ queryKey: getAdminGetBrowsableTableDataQueryKey(table) })
    } catch (error) {
      // Matches the grid's own verify: the API answers a missing row with an empty 404.
      const status = (error as { response?: { status?: number } } | null)?.response?.status
      const message = status === 404 ? 'it no longer exists' : apiErrorMessage(error).title
      setOutcomes(prev => ({ ...prev, [key]: { status: 'error', message } }))
    }
  }

  // R7: skip already-verified rows, one request at a time in list order, continuing past a failure
  // (verifyOne catches its own error rather than throwing).
  async function verifyAllShown() {
    setRunningAll(true)
    for (const row of snapshot) {
      if (isVerified(row)) continue
      await verifyOne(row)
    }
    setRunningAll(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{`Verify ${snapshot.length} selected ${snapshot.length === 1 ? 'row' : 'rows'}`}</DialogTitle>
          <DialogDescription>Verify rows by hand, one at a time or all at once.</DialogDescription>
        </DialogHeader>

        <div className="flex justify-end">
          <Button type="button" variant="outline" size="sm" disabled={runningAll || remaining === 0} onClick={() => void verifyAllShown()}>
            Verify all shown
          </Button>
        </div>

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
