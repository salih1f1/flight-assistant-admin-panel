import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AirlineName, AirportName, LoyaltyProgramName, LoyaltyTierName } from '@/components/ReferenceNames'
import { RevealableValue } from '@/components/RevealableValue'
import { useAdminGetTravelerDetail } from '@/api/generated/admin'
import type { AdminTravelerDetailDto } from '@/api/generated/model'
import { apiErrorMessage } from '@/lib/apiError'
import { formatUtcMinute } from '@/lib/formatUtc'
import { isTravelerId } from '@/lib/travelerId'

// SensitiveProperties.RedactedPlaceholder: what the API sends in place of a sensitive value.
const MASKED = '<redacted>'

// GetAdminTravelerDetailQueryHandler.MaxTrackedFlights.
const MAX_TRACKED_FLIGHTS = 50

/**
 * One traveler from GET /admin/travelers/{id}/detail: profile, device tokens, tracked flights
 * (the most recent 50) and loyalty memberships. Email, device tokens and account numbers
 * arrive masked and can be revealed, audited, like in the Data page.
 */
export function TravelerDetailPage() {
  const { id = '' } = useParams<{ id: string }>()
  const validId = isTravelerId(id)
  const { data, isLoading, error } = useAdminGetTravelerDetail(id, { query: { enabled: validId } })

  return (
    <div className="space-y-6">
      <Link to="/travelers" className="text-sm text-gray-500 hover:text-gray-900">Back to travelers</Link>
      {!validId ? (
        <Alert>{`'${id}' isn't a traveler id.`}</Alert>
      ) : error ? (
        <LoadError id={id} error={error} />
      ) : isLoading || !data ? (
        <p className="text-gray-400">Loading…</p>
      ) : (
        <TravelerDetail traveler={data} />
      )}
    </div>
  )
}

function TravelerDetail({ traveler }: { traveler: AdminTravelerDetailDto }) {
  const id = traveler.id ?? ''
  const tokens = traveler.deviceTokens ?? []
  const flights = traveler.trackedFlights ?? []
  const memberships = traveler.loyaltyMemberships ?? []

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900">{traveler.displayName || 'Traveler'}</h1>
        <Button asChild variant="outline">
          <Link to={`/flights/track?${new URLSearchParams({ traveler: id })}`}>Track a flight</Link>
        </Button>
      </div>

      <Section id="traveler-profile" title="Profile">
        <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
          <Fact label="Id"><span className="font-mono text-xs">{id}</span></Fact>
          <Fact label="Email">
            <Sensitive value={traveler.email} table="travelers" id={id} column="Email" />
          </Fact>
          <Fact label="Registered">{traveler.createdUtc ? `${formatUtcMinute(traveler.createdUtc)} UTC` : '—'}</Fact>
        </dl>
      </Section>

      <Section id="traveler-device-tokens" title="Device tokens">
        {tokens.length === 0 ? (
          <Empty>No device tokens.</Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Platform</TableHead>
                <TableHead>Token</TableHead>
                <TableHead>Last seen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tokens.map(token => (
                <TableRow key={token.id}>
                  <TableCell>{token.platform ?? '—'}</TableCell>
                  <TableCell>
                    <Sensitive value={token.token} table="device-tokens" id={token.id ?? ''} column="Token" />
                  </TableCell>
                  <TableCell>{token.lastSeenUtc ? `${formatUtcMinute(token.lastSeenUtc)} UTC` : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section id="traveler-tracked-flights" title="Tracked flights">
        {flights.length === 0 ? (
          <Empty>No tracked flights.</Empty>
        ) : (
          <>
            {traveler.trackedFlightsTruncated && (
              <p className="text-sm text-amber-700">
                {`Showing the ${MAX_TRACKED_FLIGHTS} most recent tracked flights. `}
                <Link
                  to={`/data/traveler-flights?${new URLSearchParams({ filter: `TravelerId:${id}` })}`}
                  className="underline"
                >
                  See all in the Data page
                </Link>
              </p>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Flight</TableHead>
                  <TableHead>Service date</TableHead>
                  <TableHead>Airline</TableHead>
                  <TableHead>Route</TableHead>
                  <TableHead>Notifications</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {flights.map(flight => (
                  <TableRow key={flight.trackingId}>
                    <TableCell>
                      {flight.flightId != null ? (
                        <Link to={`/flights/${flight.flightId}`} className="underline">{flight.flightNumber ?? `Flight ${flight.flightId}`}</Link>
                      ) : (
                        flight.flightNumber ?? '—'
                      )}
                    </TableCell>
                    <TableCell>{flight.serviceDate ?? '—'}</TableCell>
                    <TableCell><AirlineName id={flight.airlineId} /></TableCell>
                    <TableCell>
                      <AirportName id={flight.departureAirportId} />
                      {' → '}
                      <AirportName id={flight.arrivalAirportId} />
                    </TableCell>
                    <TableCell>{flight.notify ? 'On' : 'Off'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </Section>

      <Section id="traveler-loyalty-memberships" title="Loyalty memberships">
        {memberships.length === 0 ? (
          <Empty>No loyalty memberships.</Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Program</TableHead>
                <TableHead>Account number</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead>Tier expiry</TableHead>
                <TableHead>Points expiry</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {memberships.map(membership => (
                <TableRow key={membership.id}>
                  <TableCell><LoyaltyProgramName id={membership.programId} /></TableCell>
                  <TableCell>
                    <Sensitive value={membership.accountNumber} table="traveler-loyalty-memberships" id={membership.id ?? ''} column="AccountNumber" />
                  </TableCell>
                  <TableCell><LoyaltyTierName programId={membership.programId} tierId={membership.tierId} /></TableCell>
                  <TableCell>{membership.tierExpiryDate ?? '—'}</TableCell>
                  <TableCell>{membership.pointsExpiryDate ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
    </>
  )
}

/** A value the API may have masked: revealable when masked, shown as-is otherwise. */
function Sensitive({ value, table, id, column }: { value: string | null | undefined; table: string; id: string; column: string }) {
  if (value === MASKED && id) return <RevealableValue key={`${table}|${id}|${column}`} table={table} id={id} column={column} />
  return <>{value ?? '—'}</>
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
  // The detail endpoint answers a missing traveler with an empty 404 (Results.NotFound()).
  const status = (error as { response?: { status?: number } } | null)?.response?.status
  if (status === 404) return <Alert>{`No traveler with id ${id}.`}</Alert>
  const { title, detail } = apiErrorMessage(error)
  return (
    <Alert>
      <p>{`Could not load traveler: ${title}`}</p>
      {detail && <p className="mt-1 text-xs text-red-600">{detail}</p>}
    </Alert>
  )
}
