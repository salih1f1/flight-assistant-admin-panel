import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useStaleAfterDays } from './staleWindow'
import { verificationState } from './verificationState'

type Row = Record<string, unknown>

/**
 * The status badge for one row, shared by the grid and the record page. variant="outline" is the
 * base because it carries no background or hover styling of its own (unlike default/destructive/
 * secondary) for state.tone to override cleanly; whitespace-nowrap keeps a long "Verified ·
 * {source}" label from wrapping into a multi-line pill when auto table layout shrinks the column
 * (jsdom can't lay this out, so this one line has no break-proof).
 *
 * Reads the stale window itself rather than taking it as a prop: the data browser memoizes its cell
 * renderers, and a window arriving after the first render would rebuild every column and remount
 * the cells, dropping any revealed value with them.
 */
export function VerificationStatusBadge({ row }: { row: Row }) {
  const staleAfterDays = useStaleAfterDays()
  const state = verificationState(row, { staleAfterDays })
  // A row has at most one of the two — an issue belongs to an unverified row, a stale note to a
  // verified one — so the hover text is whichever it has.
  const detail = state.issue ?? state.staleNote
  return (
    <Badge variant="outline" className={cn(state.tone, 'whitespace-nowrap')} title={detail}>
      {state.label}
      {detail && <span className="sr-only">{`: ${detail}`}</span>}
    </Badge>
  )
}
