import type { AdminFlightSyncResultDto } from '@/api/generated/model'
import { formatUtcMinute } from '@/lib/formatUtc'

/**
 * Tint per FlightSyncMode, spec §3.3. Stopped and an absent mode get none: they are the ordinary
 * resting states, and colouring them would leave nothing for the modes that actually cost calls.
 * Colour is never the only signal — the mode's name is always rendered as text beside it.
 */
export const SYNC_MODE_TONES: Record<string, string> = {
  Fast: 'bg-green-100 text-green-800',
  Live: 'bg-blue-100 text-blue-800',
  Schedule: 'bg-gray-100 text-gray-700',
  Stopped: 'bg-transparent text-gray-700',
}

/**
 * The loop wakes every minute, so a next sync a little past due is ordinary lag. Five minutes past
 * is not: it means the background service isn't running, which nothing else in the panel surfaces.
 */
export const OVERDUE_AFTER_MS = 5 * 60 * 1000

export const isNextSyncOverdue = (nextSyncDueUtc: string | null | undefined, now: number): boolean =>
  nextSyncDueUtc != null && now - new Date(nextSyncDueUtc).getTime() > OVERDUE_AFTER_MS

/**
 * What each FlightStatusSyncOutcome means, in the words spec §3.1 settled on. The backend sends
 * the outcome as its name rather than its number precisely so this map can key off it, and so an
 * outcome added later can't silently become a different one here.
 *
 * ScheduleUpdated and NotInSchedule cannot occur until the backend's daily schedule check exists
 * (#444). They are handled anyway: the alternative is that the day it ships, this panel starts
 * rendering the unrecognised-outcome fallback at people.
 */
const MESSAGES: Record<string, string> = {
  StatusUpdated: 'New status recorded.',
  NoChange: 'Checked, nothing changed.',
  NoDataYet: 'AeroAPI has no live data for this flight yet.',
  ScheduleUpdated: 'The scheduled times changed and were updated.',
  NotInSchedule: "This flight is no longer in the airline's schedule.",
  NotTracked: "No traveler tracks this flight, so it isn't synced.",
}

/**
 * One line saying what a manual sync did, plus when the next one is due. Shared by the flights
 * grid and the flight detail page so the two can't drift on what an outcome means.
 *
 * An outcome this panel doesn't know still produces a line naming it: a blank result would read
 * as "the sync did nothing", which is a claim of its own rather than an absence of one.
 */
export function syncResultMessage(result: AdminFlightSyncResultDto): string {
  const outcome = result.outcome?.trim()
  const message = (outcome && MESSAGES[outcome])
    ?? (outcome ? `Synced. The API reported "${outcome}", which this panel doesn't recognise.` : 'Synced.')

  return result.nextSyncDueUtc
    ? `${message} Next sync ${formatUtcMinute(result.nextSyncDueUtc)} UTC.`
    : message
}
