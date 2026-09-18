import { Link } from 'react-router-dom'
import {
  useAdminGetAirlineById, useAdminGetAirportById, useAdminGetAllAlliances, useAdminGetFlightById,
  useAdminGetLoungeById, useAdminGetTravelerById,
} from '@/api/generated/admin'
import { useLoungeProvider } from '@/api/loungeLookups'
import { useLoyaltyProgram, useLoyaltyProgramKinds } from '@/api/loyaltyLookups'
import { isTravelerId, shortId } from '@/lib/travelerId'

/*
 * Names for the ids the API hands back (a flight's airline, a lounge's airport, a membership's
 * program and tier), so pages don't show bare numbers. Each lookup is cached per id, so a page
 * with fifty flights on one airline fetches that airline once.
 *
 * While a lookup is in flight the id shows as "#7"; when the record doesn't exist it stays
 * visible as "#7, not found" rather than disappearing.
 */

// The by-id routes are {id:int}. Anything else matches no route, and an unmatched /admin route
// fails the CORS preflight instead of returning 404, so such an id is never sent.
const isApiId = (id: number | null | undefined): id is number =>
  typeof id === 'number' && Number.isInteger(id) && id > 0 && id <= 2_147_483_647

const statusOf = (error: unknown) => (error as { response?: { status?: number } } | null)?.response?.status

// A missing record won't appear on a retry; anything else gets the one retry the app allows.
const retryUnless404 = (failureCount: number, error: unknown) => statusOf(error) !== 404 && failureCount < 1

const withCode = (name: string | null | undefined, code: string | null | undefined) =>
  code ? `${name ?? 'Unnamed'} (${code})` : (name ?? 'Unnamed')

function Pending({ label }: { label: string }) {
  return <span className="text-gray-400">{label}</span>
}

function NotFound({ label }: { label: string }) {
  return <span className="text-amber-700">{`${label}, not found`}</span>
}

function NameLink({ to, title, children }: { to: string; title?: string; children: string }) {
  return <Link to={to} title={title} className="underline decoration-gray-300 hover:decoration-gray-900">{children}</Link>
}

/** "British Airways (BA)", linking to the airline. */
export function AirlineName({ id }: { id: number | null | undefined }) {
  const valid = isApiId(id)
  const { data, error } = useAdminGetAirlineById(valid ? id : 0, { query: { enabled: valid, retry: retryUnless404 } })
  if (id == null) return <>—</>
  // An id no route could match names no record: say so without asking the API.
  if (!valid) return <NotFound label={`#${id}`} />
  if (statusOf(error) === 404) return <NotFound label={`#${id}`} />
  if (!data) return <Pending label={`#${id}`} />
  return <NameLink to={`/data/airlines/${id}`}>{withCode(data.name, data.iata ?? data.icao)}</NameLink>
}

/** "London Heathrow (LHR)", linking to the airport. */
export function AirportName({ id }: { id: number | null | undefined }) {
  const valid = isApiId(id)
  const { data, error } = useAdminGetAirportById(valid ? id : 0, { query: { enabled: valid, retry: retryUnless404 } })
  if (id == null) return <>—</>
  // An id no route could match names no record: say so without asking the API.
  if (!valid) return <NotFound label={`#${id}`} />
  if (statusOf(error) === 404) return <NotFound label={`#${id}`} />
  if (!data) return <Pending label={`#${id}`} />
  return <NameLink to={`/data/airports/${id}`}>{withCode(data.name, data.iata ?? data.icao)}</NameLink>
}

/**
 * "LGW", the airport's full name on hover, linking to the airport: AirportName in the width a grid
 * cell has. A route is read as three letters, and a column of "London Gatwick (LGW)" is mostly the
 * part you already know — so the code carries the column and the name stays a hover away, spelled
 * out in full wherever there is room for it (the record and detail pages keep AirportName).
 */
export function AirportCode({ id }: { id: number | null | undefined }) {
  const valid = isApiId(id)
  const { data, error } = useAdminGetAirportById(valid ? id : 0, { query: { enabled: valid, retry: retryUnless404 } })
  if (id == null) return <>—</>
  // An id no route could match names no record: say so without asking the API.
  if (!valid) return <NotFound label={`#${id}`} />
  if (statusOf(error) === 404) return <NotFound label={`#${id}`} />
  if (!data) return <Pending label={`#${id}`} />
  // An airport with neither code is shown by name: there is nothing shorter to call it.
  return (
    <NameLink to={`/data/airports/${id}`} title={data.name ?? undefined}>
      {data.iata ?? data.icao ?? data.name ?? 'Unnamed'}
    </NameLink>
  )
}

/**
 * "Galleries Club · LHR T3", linking to the lounge. A lounge's name identifies nothing on its own:
 * Galleries Club is a lounge in two Heathrow terminals and one at Gatwick. Which airport and which
 * terminal is what tells them apart — the same three things the lounges grid is a list of — so both
 * ride along, the airport as its code with the full name on hover. Until the airport lookup lands
 * (or where the lounge names no airport) the name stands alone, which is what the API sent.
 */
export function LoungeName({ id }: { id: number | null | undefined }) {
  const valid = isApiId(id)
  const { data, error } = useAdminGetLoungeById(valid ? id : 0, { query: { enabled: valid, retry: retryUnless404 } })
  const airportId = data?.airportId
  const { data: airport } = useAdminGetAirportById(isApiId(airportId) ? airportId : 0, { query: { enabled: isApiId(airportId), retry: retryUnless404 } })
  if (id == null) return <>—</>
  // An id no route could match names no record: say so without asking the API.
  if (!valid) return <NotFound label={`#${id}`} />
  if (statusOf(error) === 404) return <NotFound label={`#${id}`} />
  if (!data) return <Pending label={`#${id}`} />
  const where = [airport?.iata ?? airport?.icao, data.terminal].filter(Boolean).join(' ')
  return (
    <NameLink to={`/data/lounges/${id}`} title={airport?.name ?? undefined}>
      {[data.name ?? `#${id}`, where].filter(Boolean).join(' · ')}
    </NameLink>
  )
}

/**
 * "Priority Pass (PP)", linking to the provider. The API has no route that returns one — only
 * verify, import and export — so the name comes from the browsable table, read once for the page.
 */
export function LoungeProviderName({ id }: { id: number | null | undefined }) {
  const valid = isApiId(id)
  const { data, isSuccess } = useLoungeProvider(valid ? id : null)
  if (id == null) return <>—</>
  // An id no route could match names no record: say so without asking the API.
  if (!valid) return <NotFound label={`#${id}`} />
  if (isSuccess && !data) return <NotFound label={`#${id}`} />
  if (!data) return <Pending label={`#${id}`} />
  return <NameLink to={`/data/lounge-providers/${id}`}>{withCode(data.name, data.code)}</NameLink>
}

/** "Executive Club (EXEC_CLUB)", linking to the program. There is no by-id endpoint; the lookup walks the list. */
export function LoyaltyProgramName({ id }: { id: number | null | undefined }) {
  const valid = isApiId(id)
  const { data, isSuccess } = useLoyaltyProgram(valid ? id : undefined)
  if (id == null) return <>—</>
  // An id no route could match names no record: say so without asking the API.
  if (!valid) return <NotFound label={`#${id}`} />
  if (isSuccess && !data) return <NotFound label={`#${id}`} />
  if (!data) return <Pending label={`#${id}`} />
  return <NameLink to={`/data/loyalty-programs/${id}`}>{withCode(data.name, data.code)}</NameLink>
}

/**
 * "Airline programme", linking to the kind. Kinds are a short table read in one request and cached,
 * so a grid of fifty programs asks for the list once rather than per row.
 */
export function LoyaltyProgramKindName({ id }: { id: number | null | undefined }) {
  const valid = isApiId(id)
  const { data, isSuccess } = useLoyaltyProgramKinds()
  if (id == null) return <>—</>
  // An id no row could carry names no record: say so without waiting on the list.
  if (!valid) return <NotFound label={`#${id}`} />
  const kind = data?.find(k => k.id === id)
  // The code (AIRLINE, HOTEL) says the same thing as the name here, so the name stands alone.
  if (kind) return <NameLink to={`/data/loyalty-program-kinds/${id}`}>{kind.name || `#${id}`}</NameLink>
  if (isSuccess) return <NotFound label={`#${id}`} />
  return <Pending label={`#${id}`} />
}

/**
 * "oneworld", the code it is stored as on hover. A program carries its alliance as a code rather
 * than an id, and GET /admin/refdata/alliances answers with codes and names and no ids — so there
 * is no record to link to, unlike every other reference here.
 */
export function AllianceName({ code }: { code: string | null | undefined }) {
  const { data, isSuccess } = useAdminGetAllAlliances()
  if (code == null || code === '') return <>—</>
  const alliance = data?.find(a => a.code === code)
  if (alliance) return <span title={code}>{alliance.name ?? code}</span>
  // A code no alliance carries stays on screen as itself: it is what the record says.
  if (isSuccess) return <NotFound label={code} />
  return <Pending label={code} />
}

/** A tier's name, read from its program's tiers (the only place the API names a tier). */
export function LoyaltyTierName({ programId, tierId }: { programId: number | null | undefined; tierId: number | null | undefined }) {
  const valid = isApiId(programId)
  const { data, isSuccess } = useLoyaltyProgram(valid ? programId : undefined)
  if (tierId == null) return <>—</>
  const tier = data?.tiers?.find(t => t.id === tierId)
  if (tier) return <>{tier.name ?? `#${tierId}`}</>
  if (!valid || isSuccess) return <NotFound label={`#${tierId}`} />
  return <Pending label={`#${tierId}`} />
}

/** "Ann Example", linking to the traveler. Their id is a guid, so it stands in shortened. */
export function TravelerName({ id }: { id: string | null | undefined }) {
  const valid = typeof id === 'string' && isTravelerId(id)
  const { data, error } = useAdminGetTravelerById(valid ? id : '', { query: { enabled: valid, retry: retryUnless404 } })
  if (id == null || id === '') return <>—</>
  // An id no route could match names no record: say so without asking the API.
  if (!valid) return <NotFound label={id} />
  if (statusOf(error) === 404) return <NotFound label={`#${shortId(id)}`} />
  if (!data) return <Pending label={`#${shortId(id)}`} />
  // A traveler need not have given a display name, and their email arrives masked.
  return <NameLink to={`/travelers/${id}`}>{data.displayName || `#${shortId(id)}`}</NameLink>
}

/** "BA117 · 2026-09-20", linking to the flight: a flight number alone repeats every service day. */
export function FlightName({ id }: { id: number | null | undefined }) {
  const valid = isApiId(id)
  const { data, error } = useAdminGetFlightById(valid ? id : 0, { query: { enabled: valid, retry: retryUnless404 } })
  if (id == null) return <>—</>
  // An id no route could match names no record: say so without asking the API.
  if (!valid) return <NotFound label={`#${id}`} />
  if (statusOf(error) === 404) return <NotFound label={`#${id}`} />
  if (!data) return <Pending label={`#${id}`} />
  return <NameLink to={`/flights/${id}`}>{[data.flightNumber || `#${id}`, data.serviceDate].filter(Boolean).join(' · ')}</NameLink>
}
