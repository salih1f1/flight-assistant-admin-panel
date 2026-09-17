type Row = Record<string, unknown>

/**
 * Row tint per FlightSyncMode (spec §3.3): a light background plus a coloured left border, so a
 * page of flights shows at a glance which ones are actually being polled.
 *
 * These are row tints and deliberately not the label tints in `flights/syncOutcome.ts`
 * (`SYNC_MODE_TONES`), which colour a single badge on the detail page. A whole row needs a much
 * lighter ground to keep its text readable, and a border to carry the colour a 50-tint can't.
 * Same colour per mode, different weight — the pairing is what a reader matches on.
 */
const ROW_TONES: Record<string, string> = {
  Fast: 'bg-green-50 border-l-4 border-l-green-500',
  Live: 'bg-blue-50 border-l-4 border-l-blue-500',
  Schedule: 'bg-gray-50 border-l-4 border-l-gray-400',
}

/** A flight the airline no longer schedules — worth seeing above whatever its mode is. */
const MISSING_TONE = 'bg-red-50 border-l-4 border-l-red-500'

/**
 * Stopped and an absent mode get no tint: they are the ordinary resting states, and colouring them
 * would leave nothing for the modes that cost calls. Colour is never the only signal — the grid
 * renders the SyncMode column as text beside it.
 *
 * Reads raw `/admin/data/flights` column names, so it is safe to call for any table: one without
 * these columns simply gets no tint.
 */
export function syncRowTone(row: Row): string {
  const missingSince = row.ScheduleMissingSinceUtc
  if (typeof missingSince === 'string' && missingSince !== '') return MISSING_TONE

  // Only a name. The backend renders enum columns as their names (#392); a number here would mean
  // that regressed, and mapping it by position would paint rows on a guess rather than a reading.
  const mode = row.SyncMode
  return (typeof mode === 'string' && ROW_TONES[mode]) || ''
}

/** The legend above the flights grid: every state that can colour a row, in the order rows earn them. */
export const SYNC_LEGEND: { label: string; tone: string }[] = [
  { label: 'Fast', tone: ROW_TONES.Fast },
  { label: 'Live', tone: ROW_TONES.Live },
  { label: 'Schedule', tone: ROW_TONES.Schedule },
  { label: 'Not in schedule', tone: MISSING_TONE },
]
