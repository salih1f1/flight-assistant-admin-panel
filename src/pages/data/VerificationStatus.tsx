import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { verificationState } from './verificationState'

type Row = Record<string, unknown>

/**
 * The status badge for one row, shared by the grid and the record page. variant="outline" is the
 * base because it carries no background or hover styling of its own (unlike default/destructive/
 * secondary) for state.tone to override cleanly; whitespace-nowrap keeps a long "Verified ·
 * {source}" label from wrapping into a multi-line pill when auto table layout shrinks the column
 * (jsdom can't lay this out, so this one line has no break-proof).
 */
export function VerificationStatusBadge({ row }: { row: Row }) {
  const state = verificationState(row)
  return (
    <Badge variant="outline" className={cn(state.tone, 'whitespace-nowrap')} title={state.issue}>
      {state.label}
      {state.issue && <span className="sr-only">{`: ${state.issue}`}</span>}
    </Badge>
  )
}
