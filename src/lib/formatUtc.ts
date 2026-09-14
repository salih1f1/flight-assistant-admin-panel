/**
 * "2026-09-13 20:10": an API timestamp to the minute, in UTC. The backend works in
 * UTC throughout (the AeroAPI budget month, sync schedules), so the panel shows
 * UTC rather than converting to the viewer's zone. Callers append " UTC".
 */
export const formatUtcMinute = (iso: string) => new Date(iso).toISOString().slice(0, 16).replace('T', ' ')

/** "Sep 8": an API timestamp's UTC calendar day, as the dashboard's windows and trends name days. */
export const formatUtcDay = (date: Date) =>
  date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
