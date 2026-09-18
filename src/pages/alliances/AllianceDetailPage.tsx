import { Link, useParams } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAdminGetAllianceDetail } from '@/api/generated/admin'
import type { AllianceAirlineDto, AllianceDetailAdminDto } from '@/api/generated/model'
import { apiErrorMessage } from '@/lib/apiError'

// The detail route is {id:int}. Anything else matches no route, and an unmatched /admin route
// fails the CORS preflight rather than returning a 404 the page could report.
const isAllianceId = (id: string) => /^\d+$/.test(id) && Number(id) <= 2_147_483_647

/**
 * One alliance from GET /admin/alliances/{id}/detail: the alliance and every airline whose
 * AllianceCode is its Code, ordered by name by the API.
 *
 * The list is deliberately uncapped on the API side — airlines-per-alliance is bounded by how many
 * airlines exist, not by how long the app has run — so there is no "showing N of M" affordance to
 * render here, unlike the traveler and flight drill-downs.
 */
export function AllianceDetailPage() {
  const { id = '' } = useParams<{ id: string }>()
  const valid = isAllianceId(id)
  const { data, isLoading, error } = useAdminGetAllianceDetail(Number(id), { query: { enabled: valid } })

  return (
    <div className="space-y-6">
      <Link to="/data/alliances" className="text-sm text-gray-500 hover:text-gray-900">Back to alliances</Link>
      {!valid ? (
        <p className="text-sm text-red-600">{`'${id}' isn't an alliance id.`}</p>
      ) : error ? (
        <LoadError error={error} />
      ) : isLoading || !data ? (
        <p className="text-gray-400">Loading…</p>
      ) : (
        <AllianceDetail id={id} alliance={data} />
      )}
    </div>
  )
}

/** apiErrorMessage returns a title and an optional detail, not a string. */
function LoadError({ error }: { error: unknown }) {
  const { title, detail } = apiErrorMessage(error)
  return (
    <div className="text-sm text-red-600">
      <p>{`Could not load this alliance: ${title}`}</p>
      {detail && <p className="mt-1 text-xs">{detail}</p>}
    </div>
  )
}

function AllianceDetail({ id, alliance }: { id: string; alliance: AllianceDetailAdminDto }) {
  const airlines = alliance.airlines ?? []

  return (
    <>
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-2xl font-bold text-gray-900">{alliance.name}</h1>
        <span className="rounded bg-gray-100 px-2 py-0.5 font-mono text-sm text-gray-700">{alliance.code}</span>
        {/* Alliances no longer open in the generic record view, which is where the raw columns and
            the verify toggle live — so this link is what keeps verifying one click away. */}
        <Link to={`/data/alliances/${id}`} className="ml-auto text-sm text-gray-500 hover:text-gray-900">
          View raw record
        </Link>
      </div>

      <Card>
        <CardContent className="pt-6">
          <p className="mb-4 text-sm text-gray-500">
            {airlines.length === 1 ? '1 airline' : `${airlines.length} airlines`} in this alliance
          </p>
          {airlines.length === 0 ? (
            <p className="text-sm text-gray-500">
              No airlines are in this alliance. An airline joins one by setting its Alliance on the
              airline's own record.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>IATA</TableHead>
                  <TableHead>ICAO</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Country</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {airlines.map(airline => <AirlineRow key={airline.id} airline={airline} />)}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  )
}

function AirlineRow({ airline }: { airline: AllianceAirlineDto }) {
  return (
    <TableRow>
      <TableCell className="font-mono">{airline.iata ?? '—'}</TableCell>
      <TableCell className="font-mono">{airline.icao ?? '—'}</TableCell>
      <TableCell data-testid="alliance-airline-name">
        <Link to={`/data/airlines/${airline.id}`} className="text-blue-600 hover:underline">
          {airline.name}
        </Link>
      </TableCell>
      <TableCell>{airline.countryCode ?? '—'}</TableCell>
    </TableRow>
  )
}
