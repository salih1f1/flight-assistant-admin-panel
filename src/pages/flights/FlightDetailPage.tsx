import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AirlineName, AirportName } from '@/components/ReferenceNames'
import { adminSyncFlightStatus, getAdminGetFlightDetailQueryKey, useAdminGetFlightDetail } from '@/api/generated/admin'
import type { AdminFlightDetailDto, AdminFlightStatusEventDto } from '@/api/generated/model'
import { invalidateRawTables } from '@/api/cache'
import { apiErrorMessage } from '@/lib/apiError'
import { formatUtcMinute } from '@/lib/formatUtc'
import { cn } from '@/lib/utils'
import { isFirstSyncQueued, isNextSyncOverdue, SYNC_MODE_TONES, syncResultMessage } from './syncOutcome'

// GetAdminFlightDetailQueryHandler.MaxStatusHistory.
const MAX_STATUS_HISTORY = 50

// The detail route is {id:int}. Anything else (letters, or a number past int's range) matches no
// route, and an unmatched /admin route fails the CORS preflight instead of returning 404.
const isFlightId = (id: string) => /^\d+$/.test(id) && Number(id) <= 2_147_483_647

const utc = (iso: string | null | undefined) => (iso ? `${formatUtcMinute(iso)} UTC` : '—')

const statusLabel = (event: AdminFlightStatusEventDto) => `${event.statusName ?? 'Unknown'} (${event.statusCode ?? '?'})`

/**
 * One flight from GET /admin/flights/{id}/detail: schedule and live times, its current status
 * (the newest status event) and the 50 most recent status events, newest first.
 */
export function FlightDetailPage() {
  const { id = '' } = useParams<{ id: string }>()
  const valid = isFlightId(id)
  const { data, isLoading, error } = useAdminGetFlightDetail(Number(id), { query: { enabled: valid } })

  return (
    <div className="space-y-6">
      <Link to="/flights" className="text-sm text-gray-500 hover:text-gray-900">Back to flights</Link>
      {!valid ? (
        <Alert>{`'${id}' isn't a flight id.`}</Alert>
      ) : error ? (
        <LoadError id={id} error={error} />
      ) : isLoading || !data ? (
        <p className="text-gray-400">Loading…</p>
      ) : (
        <FlightDetail flight={data} />
      )}
    </div>
  )
}

function FlightDetail({ flight }: { flight: AdminFlightDetailDto }) {
  const history = flight.statusHistory ?? []
  const current = flight.currentStatus
  const title = [flight.flightNumber || 'Flight', flight.serviceDate].filter(Boolean).join(' · ')

  return (
    <>
      <h1 className="text-2xl font-bold text-gray-900">{title}</h1>

      <Section id="flight-overview" title="Flight">
        <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Airline"><AirlineName id={flight.airlineId} /></Fact>
          <Fact label="Route">
            <AirportName id={flight.departureAirportId} />
            {' → '}
            <AirportName id={flight.arrivalAirportId} />
          </Fact>
          <Fact label="Aircraft">{flight.equipmentAircraftIcao ?? '—'}</Fact>
          <div className="hidden lg:block" />
          <Fact label="Scheduled departure">{utc(flight.scheduledDepartureUtc)}</Fact>
          <Fact label="Estimated departure">{utc(flight.estimatedDepartureUtc)}</Fact>
          <Fact label="Actual departure">{utc(flight.actualDepartureUtc)}</Fact>
          <div className="hidden lg:block" />
          <Fact label="Scheduled arrival">{utc(flight.scheduledArrivalUtc)}</Fact>
          <Fact label="Estimated arrival">{utc(flight.estimatedArrivalUtc)}</Fact>
          <Fact label="Actual arrival">{utc(flight.actualArrivalUtc)}</Fact>
        </dl>
      </Section>

      <SyncSection flight={flight} />

      <Section id="flight-current-status" title="Current status">
        {current ? (
          <p className="text-sm">
            {`${statusLabel(current)} since ${utc(current.effectiveAtUtc)}, from ${current.source ?? 'an unknown source'}`}
          </p>
        ) : (
          <Empty>No status recorded yet.</Empty>
        )}
      </Section>

      <Section id="flight-status-history" title="Status history">
        {history.length === 0 ? (
          <Empty>No status events.</Empty>
        ) : (
          <>
            {flight.statusHistoryTruncated && (
              <p className="text-sm text-amber-700">
                {`Showing the ${MAX_STATUS_HISTORY} most recent status events. `}
                <Link
                  to={`/data/flight-status-events?${new URLSearchParams({ filter: `FlightId:${flight.id}`, sort: '-EffectiveAtUtc' })}`}
                  className="underline"
                >
                  See all in the Data page
                </Link>
              </p>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Effective</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Provider status</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Recorded</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map(event => (
                  <TableRow key={event.id}>
                    <TableCell>{utc(event.effectiveAtUtc)}</TableCell>
                    <TableCell>{statusLabel(event)}</TableCell>
                    <TableCell>{event.providerRawStatus ?? '—'}</TableCell>
                    <TableCell>{event.source ?? '—'}</TableCell>
                    <TableCell>{utc(event.recordedAtUtc)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </Section>
    </>
  )
}

/**
 * How this flight is being polled, and a way to poll it now (spec §3.2). The five fields behind it
 * live on the flight and were previously visible only in the raw data browser, so an operator had
 * no way to tell an actively-polled flight from one the loop has stopped touching.
 */
function SyncSection({ flight }: { flight: AdminFlightDetailDto }) {
  const queryClient = useQueryClient()
  const sync = useMutation({
    mutationFn: () => adminSyncFlightStatus(flight.id!),
    onSuccess: () => {
      // The sync re-plans the flight and may record a status event, so the page it's shown on and
      // the raw grids both go stale.
      void queryClient.invalidateQueries({ queryKey: getAdminGetFlightDetailQueryKey(flight.id!) })
      void invalidateRawTables(queryClient)
    },
  })

  const mode = flight.syncMode
  const now = Date.now()
  const overdue = isNextSyncOverdue(flight.nextSyncDueUtc, now)
  const queued = isFirstSyncQueued(flight.lastSyncedUtc, flight.nextSyncDueUtc, now)

  return (
    <Section id="flight-sync" title="Sync">
      <div className="flex flex-wrap items-center gap-3">
        {mode ? (
          <span className={cn('rounded-md px-2 py-0.5 text-sm font-medium', SYNC_MODE_TONES[mode] ?? 'bg-gray-100 text-gray-700')}>
            {mode}
          </span>
        ) : (
          // Not a blank mode: "no plan" is a fact about the flight, and its reason is the useful part.
          <Empty>Not synced (no traveler tracks this flight)</Empty>
        )}
        <Button size="sm" variant="outline" disabled={sync.isPending} onClick={() => sync.mutate()}>
          {sync.isPending ? 'Syncing…' : 'Sync now'}
        </Button>
      </div>

      <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Last sync">{utc(flight.lastSyncedUtc)}</Fact>
        <Fact label="Next sync">{utc(flight.nextSyncDueUtc)}</Fact>
      </dl>

      {overdue && (
        <p className="text-sm text-amber-700">
          Next sync overdue — the background sync may not be running.
        </p>
      )}
      {queued && (
        <p className="text-sm text-gray-500">
          First sync queued — it runs on the background sync's next pass.
        </p>
      )}
      {flight.scheduleMissingSinceUtc && (
        <p className="text-sm text-red-700">
          {`Not in schedule since ${utc(flight.scheduleMissingSinceUtc)}.`}
        </p>
      )}

      {sync.isSuccess && !sync.isPending && (
        <p role="status" className="text-sm text-gray-700">{syncResultMessage(sync.data)}</p>
      )}
      {sync.error && <SyncError error={sync.error} />}
    </Section>
  )
}

function SyncError({ error }: { error: unknown }) {
  const { title, detail } = apiErrorMessage(error)
  return (
    <Alert>
      <p>{`Could not sync: ${title}`}</p>
      {detail && <p className="mt-1 text-xs text-red-600">{detail}</p>}
    </Alert>
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

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-gray-500">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  )
}

const Empty = ({ children }: { children: ReactNode }) => <p className="text-sm text-gray-500">{children}</p>

function Alert({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {children}
    </div>
  )
}

function LoadError({ id, error }: { id: string; error: unknown }) {
  // The detail endpoint answers a missing flight with an empty 404 (Results.NotFound()).
  const status = (error as { response?: { status?: number } } | null)?.response?.status
  if (status === 404) return <Alert>{`No flight with id ${id}.`}</Alert>
  const { title, detail } = apiErrorMessage(error)
  return (
    <Alert>
      <p>{`Could not load flight: ${title}`}</p>
      {detail && <p className="mt-1 text-xs text-red-600">{detail}</p>}
    </Alert>
  )
}
