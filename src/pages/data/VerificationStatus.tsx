import { Badge } from '@/components/ui/badge'
import { verificationState } from './verificationState'

type Row = Record<string, unknown>

/** The status badge for one row, shared by the grid and the record page. */
export function VerificationStatusBadge({ row }: { row: Row }) {
  const state = verificationState(row)
  return (
    <Badge variant={state.variant} title={state.issue}>
      {state.label}
      {state.issue && <span className="sr-only">{`: ${state.issue}`}</span>}
    </Badge>
  )
}
