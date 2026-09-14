import { Link } from 'react-router-dom'
import { useAdminGetAirlineById, useAdminGetAirportById } from '@/api/generated/admin'
import { useLoyaltyProgram } from '@/api/loyaltyLookups'

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

function Pending({ id }: { id: number }) {
  return <span className="text-gray-400">{`#${id}`}</span>
}

function NotFound({ id }: { id: number }) {
  return <span className="text-amber-700">{`#${id}, not found`}</span>
}

function NameLink({ to, children }: { to: string; children: string }) {
  return <Link to={to} className="underline decoration-gray-300 hover:decoration-gray-900">{children}</Link>
}

/** "British Airways (BA)", linking to the airline. */
export function AirlineName({ id }: { id: number | null | undefined }) {
  const valid = isApiId(id)
  const { data, error } = useAdminGetAirlineById(valid ? id : 0, { query: { enabled: valid, retry: retryUnless404 } })
  if (id == null) return <>—</>
  // An id no route could match names no record: say so without asking the API.
  if (!valid) return <NotFound id={id} />
  if (statusOf(error) === 404) return <NotFound id={id} />
  if (!data) return <Pending id={id} />
  return <NameLink to={`/data/airlines/${id}`}>{withCode(data.name, data.iata ?? data.icao)}</NameLink>
}

/** "London Heathrow (LHR)", linking to the airport. */
export function AirportName({ id }: { id: number | null | undefined }) {
  const valid = isApiId(id)
  const { data, error } = useAdminGetAirportById(valid ? id : 0, { query: { enabled: valid, retry: retryUnless404 } })
  if (id == null) return <>—</>
  // An id no route could match names no record: say so without asking the API.
  if (!valid) return <NotFound id={id} />
  if (statusOf(error) === 404) return <NotFound id={id} />
  if (!data) return <Pending id={id} />
  return <NameLink to={`/data/airports/${id}`}>{withCode(data.name, data.iata ?? data.icao)}</NameLink>
}

/** "Executive Club (EXEC_CLUB)", linking to the program. There is no by-id endpoint; the lookup walks the list. */
export function LoyaltyProgramName({ id }: { id: number | null | undefined }) {
  const valid = isApiId(id)
  const { data, isSuccess } = useLoyaltyProgram(valid ? id : undefined)
  if (id == null) return <>—</>
  // An id no route could match names no record: say so without asking the API.
  if (!valid) return <NotFound id={id} />
  if (isSuccess && !data) return <NotFound id={id} />
  if (!data) return <Pending id={id} />
  return <NameLink to={`/data/loyalty-programs/${id}`}>{withCode(data.name, data.code)}</NameLink>
}

/** A tier's name, read from its program's tiers (the only place the API names a tier). */
export function LoyaltyTierName({ programId, tierId }: { programId: number | null | undefined; tierId: number | null | undefined }) {
  const valid = isApiId(programId)
  const { data, isSuccess } = useLoyaltyProgram(valid ? programId : undefined)
  if (tierId == null) return <>—</>
  const tier = data?.tiers?.find(t => t.id === tierId)
  if (tier) return <>{tier.name ?? `#${tierId}`}</>
  if (!valid || isSuccess) return <NotFound id={tierId} />
  return <Pending id={tierId} />
}
