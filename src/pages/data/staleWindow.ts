import { useAdminGetHealth } from '@/api/generated/admin'

/**
 * `Verification:StaleAfterDays` as GET /admin/health publishes it (backend #447): how long a row's
 * verification stays good before tracking a flight re-queues the entity. Undefined while the report
 * is loading, when the read fails, or against an API that predates the field — `verificationState`
 * then renders a row exactly as it did before staleness existed rather than guessing at a window.
 *
 * Cheap enough to call from a grid cell: App.tsx's QueryClient holds queries fresh for five
 * minutes, so every badge on a page shares one cached report, and the value itself only changes
 * when the API restarts.
 */
export function useStaleAfterDays(): number | undefined {
  const { data } = useAdminGetHealth()
  return data?.verification?.staleAfterDays
}
