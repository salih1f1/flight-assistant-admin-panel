/**
 * What share of an entity's rows are verified, as a whole number, from the two counts
 * GET /admin/stats sends. Undefined where there is no share to state: an entity with no
 * IsVerified column (travelers, flights, where the API sends null), an empty table, or counts
 * that could not be a share.
 *
 * 100 means every row is verified and 0 means none is — anything between is clamped to 1-99 rather
 * than rounded past them. A card reading "100% verified" beside rows that are not verified would be
 * the one number on the dashboard that lies, and the clamp is what a 99.99% table needs, which is
 * exactly the state a nearly-finished verification run leaves behind.
 */
export function verifiedPercent(verified: number | null | undefined, unverified: number | null | undefined): number | undefined {
  if (verified == null || unverified == null || verified < 0 || unverified < 0) return undefined

  const total = verified + unverified
  if (total === 0) return undefined

  if (verified === 0) return 0
  if (verified === total) return 100
  return Math.min(99, Math.max(1, Math.round((verified / total) * 100)))
}
