import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAdminGetTravelerById, useAdminSearchFlights, useAdminTrackFlightForTraveler } from '@/api/generated/admin'
import type { AdminSearchFlightsParams, AdminTravelerDto, FlightSearchResultDto } from '@/api/generated/model'
import { apiErrorMessage } from '@/lib/apiError'
import { formatUtcMinute } from '@/lib/formatUtc'
import { isTravelerId } from '@/lib/travelerId'

type Outcome =
  | { row: FlightSearchResultDto; flightId: number; traveler: AdminTravelerDto }
  | { row: FlightSearchResultDto; error: unknown }

// One search row: a flight designator on a date (the same aircraft under another number is another row).
const rowKey = (row: FlightSearchResultDto) => `${row.flightNumber}|${row.serviceDate}|${row.departureAirportIata}`

/**
 * Tracks a flight for a traveler, for testing: a row from GET /admin/flights/search is posted to
 * POST /admin/travelers/{id}/flights, as if the traveler had added it in the app. ?traveler={id}
 * fills in the traveler, which is how the traveler page links here. Each search that misses the
 * API's cache is a paid AeroAPI call, so searching only happens on Search.
 */
export function TrackFlightPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const travelerId = searchParams.get('traveler') ?? ''
  const validId = isTravelerId(travelerId)
  const { data: traveler, error: travelerError, isLoading: travelerLoading } = useAdminGetTravelerById(travelerId, { query: { enabled: validId } })
  const found = validId ? traveler : undefined

  const [criteria, setCriteria] = useState<AdminSearchFlightsParams>()
  const results = useAdminSearchFlights(criteria ?? { date: '' }, { query: { enabled: criteria !== undefined } })

  const trackMutation = useAdminTrackFlightForTraveler()
  const [tracked, setTracked] = useState<Record<string, number>>({})
  const [outcome, setOutcome] = useState<Outcome>()

  const track = (row: FlightSearchResultDto, traveler: AdminTravelerDto) => {
    const id = traveler.id ?? ''
    setOutcome(undefined)
    trackMutation.mutate({ id, data: row }, {
      onSuccess: response => {
        // Results.Created(..., new { flightId }); the spec declares no body, so it's typed void.
        const { flightId } = response as unknown as { flightId: number }
        setTracked(previous => ({ ...previous, [`${id}|${rowKey(row)}`]: flightId }))
        setOutcome({ row, flightId, traveler })
      },
      onError: error => setOutcome({ row, error }),
    })
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-gray-900">Track a flight</h1>
        <p className="text-sm text-gray-500">For testing: tracks a flight for a traveler, as if they had added it in the app.</p>
      </div>

      <Section id="track-traveler" title="Traveler">
        <div className="max-w-md space-y-1.5">
          <Label htmlFor="traveler-id">Traveler id</Label>
          <Input
            id="traveler-id"
            value={travelerId}
            onChange={event => setSearchParams(event.target.value ? { traveler: event.target.value } : {}, { replace: true })}
            placeholder="e.g. 3f2b8c1e-9a4d-4e6b-8f10-2c7d5e9a1b01"
            className="font-mono"
          />
        </div>
        <TravelerStatus id={travelerId} validId={validId} traveler={found} loading={travelerLoading} error={travelerError} />
      </Section>

      <Section id="track-search" title="Find the flight">
        <SearchForm onSearch={setCriteria} searching={results.isFetching} />
      </Section>

      {criteria !== undefined && (
        <Section id="track-results" title="Results">
          {outcome && <OutcomeMessage outcome={outcome} />}
          {results.error ? (
            <ErrorAlert prefix="Search failed" error={results.error} />
          ) : !results.data ? (
            <Muted>Searching…</Muted>
          ) : results.data.length === 0 ? (
            <Muted>No flights found.</Muted>
          ) : (
            <>
              {!found && <Muted>Enter a traveler id above to track a flight.</Muted>}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Flight</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Route</TableHead>
                    <TableHead>Scheduled departure</TableHead>
                    <TableHead>Scheduled arrival</TableHead>
                    <TableHead><span className="sr-only">Actions</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.data.map(row => {
                    const isTracked = found !== undefined && tracked[`${found.id}|${rowKey(row)}`] !== undefined
                    return (
                      <TableRow key={rowKey(row)}>
                        <TableCell className="font-medium">{row.flightNumber ?? '—'}</TableCell>
                        <TableCell>{row.serviceDate ?? '—'}</TableCell>
                        <TableCell>{`${row.departureAirportIata ?? '—'} → ${row.arrivalAirportIata ?? '—'}`}</TableCell>
                        <TableCell>{row.scheduledDepartureUtc ? `${formatUtcMinute(row.scheduledDepartureUtc)} UTC` : '—'}</TableCell>
                        <TableCell>{row.scheduledArrivalUtc ? `${formatUtcMinute(row.scheduledArrivalUtc)} UTC` : '—'}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant={isTracked ? 'outline' : 'default'}
                            disabled={!found || isTracked || trackMutation.isPending}
                            onClick={() => found && track(row, found)}
                          >
                            {isTracked ? 'Tracked' : 'Track'}
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </>
          )}
        </Section>
      )}
    </div>
  )
}

function TravelerStatus({ id, validId, traveler, loading, error }: {
  id: string
  validId: boolean
  traveler: AdminTravelerDto | undefined
  loading: boolean
  error: unknown
}) {
  if (!id) return <Muted>The traveler the flight is tracked for. Their page links here with the id filled in.</Muted>
  if (!validId) return <Muted>{`'${id}' isn't a traveler id.`}</Muted>
  if (traveler) {
    return (
      <p className="text-sm">
        <Link to={`/travelers/${traveler.id}`} className="font-medium underline">{traveler.displayName || traveler.id}</Link>
      </p>
    )
  }
  // The by-id endpoint answers a missing traveler with an empty 404 (Results.NotFound()).
  const status = (error as { response?: { status?: number } } | null)?.response?.status
  if (status === 404) return <Muted>No traveler with this id.</Muted>
  if (error) return <Muted>{`Could not load traveler: ${apiErrorMessage(error).title}`}</Muted>
  return loading ? <Muted>Looking up the traveler…</Muted> : null
}

/** Date, then a flight number or a from/to route. Only the API checks the codes' format. */
function SearchForm({ onSearch, searching }: { onSearch: (criteria: AdminSearchFlightsParams) => void; searching: boolean }) {
  const [date, setDate] = useState('')
  const [flightNumber, setFlightNumber] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [includeCodeshares, setIncludeCodeshares] = useState(false)
  const [problem, setProblem] = useState<string>()

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const [number, origin, destination] = [flightNumber.trim(), from.trim(), to.trim()]
    if (!date) return setProblem('Pick a date.')
    if (!number && !(origin && destination)) return setProblem('Enter a flight number, or both From and To.')
    setProblem(undefined)
    onSearch({
      date,
      ...(number && { flightNumber: number }),
      ...(origin && { from: origin }),
      ...(destination && { to: destination }),
      includeCodeshares,
    })
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <Field id="search-date" label="Date">
          <Input id="search-date" type="date" value={date} onChange={event => setDate(event.target.value)} />
        </Field>
        <Field id="search-flight-number" label="Flight number">
          <Input id="search-flight-number" value={flightNumber} onChange={event => setFlightNumber(event.target.value)} placeholder="e.g. BA117" />
        </Field>
        <Field id="search-from" label="From">
          <Input id="search-from" value={from} onChange={event => setFrom(event.target.value)} placeholder="e.g. LHR" maxLength={3} />
        </Field>
        <Field id="search-to" label="To">
          <Input id="search-to" value={to} onChange={event => setTo(event.target.value)} placeholder="e.g. JFK" maxLength={3} />
        </Field>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <input id="search-codeshares" type="checkbox" checked={includeCodeshares} onChange={event => setIncludeCodeshares(event.target.checked)} />
        <Label htmlFor="search-codeshares">Include codeshares</Label>
      </div>
      {problem && <p className="text-sm text-red-600">{problem}</p>}
      <Button type="submit" disabled={searching}>Search</Button>
    </form>
  )
}

function OutcomeMessage({ outcome }: { outcome: Outcome }) {
  if ('error' in outcome) return <ErrorAlert prefix={`Could not track ${outcome.row.flightNumber}`} error={outcome.error} />
  const { row, flightId, traveler } = outcome
  return (
    <div role="status" className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
      <p>{`Tracked ${row.flightNumber} on ${row.serviceDate} for ${traveler.displayName || traveler.id}.`}</p>
      <p className="mt-1 flex gap-4">
        <Link to={`/flights/${flightId}`} className="underline">Open flight</Link>
        <Link to={`/travelers/${traveler.id}`} className="underline">Open traveler</Link>
      </p>
    </div>
  )
}

function ErrorAlert({ prefix, error }: { prefix: string; error: unknown }) {
  const { title, detail } = apiErrorMessage(error)
  return (
    <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      <p>{`${prefix}: ${title}`}</p>
      {detail && <p className="mt-1 text-xs text-red-600">{detail}</p>}
    </div>
  )
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-3">
      <h2 id={id} className="text-lg font-semibold text-gray-900">{title}</h2>
      <Card>
        <CardContent className="space-y-3 pt-6">{children}</CardContent>
      </Card>
    </section>
  )
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  )
}

const Muted = ({ children }: { children: ReactNode }) => <p className="text-sm text-gray-500">{children}</p>
