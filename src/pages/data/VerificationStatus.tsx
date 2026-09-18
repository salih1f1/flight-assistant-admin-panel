import { CircleCheck, CircleDashed, TriangleAlert, type LucideIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useStaleAfterDays } from './staleWindow'
import { verificationState, type VerificationKind } from './verificationState'

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


/**
 * A verified row and a stale one share the tick: both have been verified, and the amber says the
 * check is old rather than that anything is wrong with it. The other two get their own shape, so
 * the states that actually differ are never told apart by colour alone.
 */
const ICONS: Record<VerificationKind, LucideIcon> = {
  verified: CircleCheck,
  stale: CircleCheck,
  attention: TriangleAlert,
  unverified: CircleDashed,
}

const ICON_TONES: Record<VerificationKind, string> = {
  verified: 'text-green-600',
  stale: 'text-amber-600',
  attention: 'text-amber-600',
  unverified: 'text-gray-400',
}

/**
 * The same state as VerificationStatusBadge above, drawn as one icon: what the grid shows, where a
 * text pill per row costs a column of width. Nothing the badge says is dropped — the full label is
 * the icon's accessible name, and the issue or stale note is still its hover text — so the colour
 * is shorthand for a label that is always there to be read, never the only way to tell two rows
 * apart. Reads the stale window itself for the same reason the badge does.
 */
export function VerificationStatusIcon({ row }: { row: Row }) {
  const staleAfterDays = useStaleAfterDays()
  const state = verificationState(row, { staleAfterDays })
  const detail = state.issue ?? state.staleNote
  const Icon = ICONS[state.kind]
  return (
    <span role="img" aria-label={state.label} title={detail} className={cn('inline-flex', ICON_TONES[state.kind])}>
      <Icon aria-hidden className="h-4 w-4" />
    </span>
  )
}
