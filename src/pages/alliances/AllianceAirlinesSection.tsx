import { Link } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAdminGetAllianceDetail } from '@/api/generated/admin'
import type { AllianceAirlineDto } from '@/api/generated/model'
import { apiErrorMessage } from '@/lib/apiError'

// The detail route is {id:int}. Anything else matches no route, and an unmatched /admin route
// fails the CORS preflight rather than returning a 404 the section could report.
const isAllianceId = (id: string) => /^\d+$/.test(id) && Number(id) <= 2_147_483_647

/**
 * The airlines in an alliance, on the alliance's own record page: the members are what an alliance
 * is, so they sit below its fields rather than behind a link to a page of their own (#174) — the
 * same relationship a loyalty program has with its tiers.
 *
 * Read from GET /admin/alliances/{id}/detail, which joins on the airline's AllianceCode and carries
 * each airline's own loyalty program (backend #495). The list is deliberately uncapped on the API
 * side — airlines-per-alliance is bounded by how many airlines exist, not by how long the app has
 * run — so there is no "showing N of M" affordance to render here.
 */
export function AllianceAirlinesSection({ id }: { id: string }) {
  const valid = isAllianceId(id)
  const { data, isLoading, error } = useAdminGetAllianceDetail(Number(id), { query: { enabled: valid } })
  const airlines = data?.airlines ?? []

  return (
    <Card>
      <CardHeader className="flex flex-row items-baseline justify-between gap-4 space-y-0">
        <CardTitle className="text-base">Airlines</CardTitle>
        {data && (
          <span className="text-sm text-gray-500">
            {airlines.length === 1 ? '1 airline' : `${airlines.length} airlines`} in this alliance
          </span>
        )}
      </CardHeader>
      <CardContent>
        {!valid ? (
          <p className="text-sm text-red-600">{`'${id}' isn't an alliance id.`}</p>
        ) : error ? (
          <LoadError error={error} />
        ) : isLoading || !data ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : airlines.length === 0 ? (
          <p className="text-sm text-gray-500">
            No airlines are in this alliance. An airline joins one by setting its Alliance on the
            airline's own record.
          </p>
        ) : (
          <Table aria-label="Airlines">
            <TableHeader>
              <TableRow>
                {/* No fixed widths: pinning the codes narrow hands every spare pixel to Name and
                    strands Country and the program against the right edge. */}
                <TableHead>IATA</TableHead>
                <TableHead>ICAO</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Country</TableHead>
                <TableHead className="w-1/3">Loyalty program</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {airlines.map(airline => <AirlineRow key={airline.id} airline={airline} />)}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

function AirlineRow({ airline }: { airline: AllianceAirlineDto }) {
  return (
    <TableRow>
      <TableCell className="font-mono text-xs">{airline.iata ?? '—'}</TableCell>
      <TableCell className="font-mono text-xs">{airline.icao ?? '—'}</TableCell>
      <TableCell data-testid="alliance-airline-name">
        <Link to={`/data/airlines/${airline.id}`} className="text-blue-600 hover:underline">
          {airline.name}
        </Link>
      </TableCell>
      <TableCell className="font-mono text-xs">{airline.countryCode ?? '—'}</TableCell>
      {/* Most airlines run no program of their own: an empty cell, not a missing row. */}
      <TableCell>{airline.loyaltyProgramName ?? <span className="text-gray-400">—</span>}</TableCell>
    </TableRow>
  )
}

/** apiErrorMessage returns a title and an optional detail, not a string. */
function LoadError({ error }: { error: unknown }) {
  const { title, detail } = apiErrorMessage(error)
  return (
    <div className="text-sm text-red-600">
      <p>{`Could not load this alliance's airlines: ${title}`}</p>
      {detail && <p className="mt-1 text-xs">{detail}</p>}
    </div>
  )
}
