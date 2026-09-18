/**
 * Status names as the API sends them, from two different enums: HealthStatus on a health check,
 * and DataSourceStatusValue on a data source (#113).
 *
 * Its own module rather than living beside the components that use it: a file exporting both a
 * component and a constant trips react-refresh/only-export-components, the same reason
 * `verificationState.ts` sits apart from its badge.
 */
export const statusTone: Record<string, string> = {
  Healthy: 'text-green-600',
  Ok: 'text-green-600',
  Degraded: 'text-amber-600',
  Unhealthy: 'text-red-600',
  // Gray, not amber: "not configured" is a deliberate choice and "unknown" is an absence of
  // information. Neither is a fault, and neither may read as healthy.
  NotConfigured: 'text-gray-500',
  Unknown: 'text-gray-500',
}

/** The tone for a status, defaulting to gray — an unrecognised status never reads as healthy. */
export const toneFor = (status: string | null | undefined) => statusTone[status ?? ''] ?? 'text-gray-500'
