import { useState } from 'react'
import { useAdminSetProviderRoute } from '@/api/generated/admin'
import type { AdminProviderRouteDto } from '@/api/generated/model'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { apiErrorMessage } from '@/lib/apiError'
import { formatUtcMinute } from '@/lib/formatUtc'

/**
 * A local copy, as in DataBrowserPage and AddMembershipDialog. The repo has not centralised this
 * string and doing it here would edit two unrelated files for a Tailwind class.
 */
const SELECT_CLASS = 'h-10 rounded-md border border-gray-200 bg-white px-3 text-sm'

/**
 * The switchable routing decisions (backend #531).
 *
 * Follows JobsSection's rules, which were settled for the same kind of control: a change barred by
 * configuration is rendered disabled and *explained* rather than hidden, a refusal is not a state
 * change, and success refetches rather than trusting the response.
 *
 * Two differences from a job switch, both deliberate:
 *
 * A job is on or off; this is a choice among providers, so the control is a select and the row must
 * say which value is actually in force. See {@link RouteRow}.
 *
 * Every change asks for a reason, where a job only asks when switching off. A job has a recovery
 * direction and making someone justify a recovery is friction at the worst moment; here both
 * directions are the same kind of act — a deliberate cost decision — and the row carries `reason`
 * for the audit either way.
 */
export function RoutingSection({ routes }: { routes: AdminProviderRouteDto[] }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Routing</h2>
        <p className="text-sm text-gray-500">
          Choose which provider serves each job. Takes effect within ten seconds; searches already
          cached keep their answer until it expires.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Decision</TableHead>
                <TableHead>In force</TableHead>
                <TableHead>Last changed</TableHead>
                <TableHead><span className="sr-only">Change</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {routes.map(route => <RouteRow key={route.job} route={route} />)}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </section>
  )
}

function RouteRow({ route }: { route: AdminProviderRouteDto }) {
  const [pending, setPending] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [failure, setFailure] = useState<string | null>(null)

  const save = useAdminSetProviderRoute({
    mutation: {
      // Deliberately no invalidateQueries call here. The app's QueryClient invalidates everything
      // after every successful mutation (`refreshAfterWrite`, #180), and its own doc says to call it
      // by hand only where a write does not go through useMutation — this one does. A key-scoped
      // call here would be a second, narrower copy of that rule, and the response cannot be trusted
      // on its own anyway: it is one route, while the call map's switchable rows report the provider
      // actually in force, so a map still naming the old provider beside a changed switch would read
      // as if the change half-worked.
      onSuccess: () => {
        setPending(null)
        setReason('')
        setFailure(null)
      },
      // A refusal leaves the row showing what the API still believes, with its message verbatim.
      // A 409 means configuration bars this key; a 400 names the provider it would not accept.
      onError: (e: unknown) => setFailure(apiErrorMessage(e).title),
    },
  })

  const barred = route.canChange === false
  const options = route.options ?? []
  const effective = route.effectiveProviders ?? []
  const stored = route.providers ?? []

  // The two differ only when configuration overrides a stored choice — the documented rollback
  // path, where a row says aerodatabox and the AeroDataBox credential has since been removed. The
  // backend splits these two fields precisely so this row can say which one is running; collapsing
  // them here would reproduce the defect that split fixed, where the page reported that a named
  // admin had chosen the provider configuration forced.
  const overridden = effective.join(',') !== stored.join(',')

  return (
    <TableRow>
      <TableCell className="font-medium align-top">{route.displayName}</TableCell>

      <TableCell className="align-top">
        <span className="font-medium text-gray-900">{effective.join(', ') || '—'}</span>

        {overridden && (
          <p className="text-xs text-amber-600">
            {`Configuration overrides the stored choice of ${stored.join(', ') || 'none'}.`}
          </p>
        )}

        {barred && (
          <p className="text-xs text-gray-500">
            This environment configures no alternative for this job. Changing it needs a deploy.
          </p>
        )}

        {route.isDefault && !overridden && (
          <p className="text-xs text-gray-400">From configuration — nobody has changed this.</p>
        )}

        {failure && <p className="text-xs text-red-600">{failure}</p>}
      </TableCell>

      <TableCell className="align-top text-sm text-gray-500">
        {route.changedUtc ? (
          <>
            <span>{`${formatUtcMinute(route.changedUtc)} UTC`}</span>
            {route.changedBy && <span className="block text-xs">{`by ${route.changedBy}`}</span>}
            {route.reason && <span className="block text-xs text-gray-400">{route.reason}</span>}
          </>
        ) : (
          '—'
        )}
      </TableCell>

      <TableCell className="align-top text-right">
        {pending ? (
          <div className="flex flex-col items-end gap-2">
            <p className="text-xs text-gray-500">{`Change to ${pending}`}</p>
            <Input
              aria-label="Reason (optional)"
              placeholder="Why? (optional)"
              value={reason}
              onChange={e => setReason(e.target.value)}
              className="max-w-xs"
            />
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => { setPending(null); setReason('') }}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={save.isPending}
                onClick={() => save.mutate({
                  job: route.job ?? '',
                  data: { providers: [pending], reason: reason.trim() || null },
                })}
              >
                Confirm
              </Button>
            </div>
          </div>
        ) : (
          <select
            aria-label={`Provider for ${route.displayName}`}
            className={SELECT_CLASS}
            disabled={barred || save.isPending}
            value={effective[0] ?? ''}
            // Selecting stages the change rather than sending it. The reason is asked before the
            // write, not after, because the audit row carries it — asking afterwards would mean
            // either a second request or an unexplained row.
            onChange={e => {
              setFailure(null)
              setPending(e.target.value === (effective[0] ?? '') ? null : e.target.value)
            }}
          >
            {options.map(option => <option key={option} value={option}>{option}</option>)}
          </select>
        )}
      </TableCell>
    </TableRow>
  )
}
