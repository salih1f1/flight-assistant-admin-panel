import type { AdminDataSourceDto } from '@/api/generated/model'

/**
 * The statuses that mean "nothing for a human to do here". Everything else — Degraded, Unhealthy,
 * and Unknown — counts as needing attention.
 *
 * Unknown counts deliberately: it means nothing has observed the source since this deploy, which is
 * exactly the state the health page exists to surface. NotConfigured does not: it is a deliberate
 * choice about this environment, not something to chase. A status this build does not recognise
 * counts too — an unfamiliar state is not evidence that all is well.
 */
const FINE = new Set(['Ok', 'NotConfigured'])

export const countsNeedingAttention = (sources: readonly AdminDataSourceDto[]): number =>
  sources.filter(source => !FINE.has(source.status ?? '')).length
