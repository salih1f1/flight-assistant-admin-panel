import type { VerificationNeedsAttentionDto } from '@/api/generated/model'

/**
 * How the needs-attention card's heading reads when something is wrong: "1 row needs attention",
 * "15 rows need attention" — the total across every entity type the report carries.
 *
 * Undefined when nothing is flagged, which is also what tells the card to stay calm: an operator
 * scanning the dashboard should be able to tell the two states apart without reading any digits,
 * so the quiet state says one line and the loud one says a number.
 */
export function needsAttentionSummary(counts: VerificationNeedsAttentionDto[]): string | undefined {
  const total = counts.reduce((sum, { count }) => sum + (count ?? 0), 0)
  if (total === 0) return undefined
  return `${total} ${total === 1 ? 'row needs' : 'rows need'} attention`
}
