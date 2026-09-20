import type { AdminProviderOperationDto } from '@/api/generated/model'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

/**
 * Which provider is called on which operation (backend #531).
 *
 * The other half of the feature: a switch is only useful if you know what it moves. Rows are
 * grouped by trigger, in the order the API sends them — the map is authored deliberately, front to
 * back, so it is not re-sorted here.
 *
 * A row whose provider is **fixed** is shown with its reason rather than omitted. Leaving it out
 * would make the page answer "which provider is called when" with only the half that happens to be
 * adjustable, and the fixed rows are where the interesting constraints live — a flight-number
 * search stays on AeroAPI because the alternative resolves a marketing number to a different
 * operating flight.
 */
export function CallMapSection({ operations }: { operations: AdminProviderOperationDto[] }) {
  const triggers = groupByTrigger(operations)

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">What gets called when</h2>
        <p className="text-sm text-gray-500">
          Every operation that reaches a provider, in call order. Prices are list prices as of the
          date shown — neither provider publishes one through an API.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Operation</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Price</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {triggers.map(([trigger, rows]) => (
                <TriggerGroup key={trigger} trigger={trigger} rows={rows} />
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </section>
  )
}

/**
 * Trigger order comes from the API, not from sorting: the map is authored in the order an operator
 * would walk it (tracking, searching, syncing, verification, the budget read). A Map preserves
 * first-seen insertion order, which is that order.
 */
function groupByTrigger(operations: AdminProviderOperationDto[]) {
  const groups = new Map<string, AdminProviderOperationDto[]>()
  for (const operation of operations) {
    const trigger = operation.trigger ?? 'Other'
    const existing = groups.get(trigger)
    if (existing) existing.push(operation)
    else groups.set(trigger, [operation])
  }
  return [...groups]
}

function TriggerGroup({ trigger, rows }: { trigger: string; rows: AdminProviderOperationDto[] }) {
  return (
    <>
      <TableRow className="bg-gray-50 hover:bg-gray-50">
        <TableCell colSpan={3} className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          {trigger}
        </TableCell>
      </TableRow>
      {rows.map(row => <OperationRow key={`${trigger}:${row.operation}`} row={row} />)}
    </>
  )
}

function OperationRow({ row }: { row: AdminProviderOperationDto }) {
  const providers = row.providers ?? []
  const switchable = row.routingKey != null

  return (
    <TableRow>
      <TableCell className="align-top">
        <span className="text-sm text-gray-900">{row.operation}</span>

        {/* Gray, never amber or red: a fixed provider is a settled design decision with a reason,
            not a fault and not something to act on. Amber here would make five of the ten rows
            look like warnings. */}
        {row.fixedReason && <p className="mt-0.5 text-xs text-gray-500">{row.fixedReason}</p>}

        {/* Amber, because this one IS something to read before acting: routing route search to
            AeroAPI puts it back behind the budget guard, which refuses from 80% of budget onward —
            so the flip can start returning 503s at exactly the moment a cost-conscious operator
            reaches for it. */}
        {row.note && <p className="mt-0.5 text-xs text-amber-600">{row.note}</p>}
      </TableCell>

      <TableCell className="align-top text-sm">
        {providers.length > 0 ? (
          <span className={switchable ? 'font-medium text-gray-900' : 'text-gray-600'}>
            {providers.join(' → ')}
          </span>
        ) : (
          <span className="text-gray-400">none directly</span>
        )}
        {switchable && <span className="block text-xs text-gray-400">Switchable above</span>}
      </TableCell>

      <TableCell className="align-top text-sm text-gray-500">{row.listPrice}</TableCell>
    </TableRow>
  )
}
