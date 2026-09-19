import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Combobox, type ComboboxOption } from '@/components/ui/combobox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAdminUpdateLoyaltyProgram } from '@/api/generated/admin'
import type { LoyaltyProgramDto } from '@/api/generated/model'
import { type LoyaltyProgramKind, useLoyaltyProgramKinds, useLoyaltyPrograms } from '@/api/loyaltyLookups'
import { apiErrorMessage } from '@/lib/apiError'

const programName = (program: LoyaltyProgramDto) => program.name ?? program.code ?? `#${program.id}`

/**
 * The loyalty programs that point at one airline, on the airline's own record page. The link runs
 * the other way already — a program's form picks its airline — and this is that same link read from
 * the airline's end: which programs claim it, and one click to each.
 *
 * A program's airline is a column on the program, so there is no endpoint for "this airline's
 * programs": the list is every program, filtered here.
 */
export function AirlineProgramsSection({ airlineId }: { airlineId: number }) {
  const { data: allPrograms, isLoading, isError } = useLoyaltyPrograms()
  const { data: kinds } = useLoyaltyProgramKinds()

  const programs = (allPrograms ?? []).filter(p => p.airlineId === airlineId)
  // An airline generally runs one loyalty program, so once it has one there is nothing to add:
  // both ways in are dropped rather than disabled, and a line below says where the rare second
  // one is added instead. Known only once the list has arrived — neither control flickers in
  // while it is loading.
  const loaded = !isError && !isLoading
  const canAdd = loaded && programs.length === 0
  // A program with no airline is free to claim. One that already has another airline is not
  // offered: moving it is a decision for that program's own page, not a side effect of this one.
  const unattached = (allPrograms ?? []).filter(p => p.airlineId == null)
  // Programs carry their kind as a code; the kinds table is the only place its name lives.
  const kindName = (code: string | null | undefined) =>
    kinds?.find(k => k.code === code)?.name ?? code ?? '—'

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
        <CardTitle className="text-base">Loyalty programs</CardTitle>
        {/* The create form, with this airline already filled in and this page to come back to. */}
        {canAdd && (
          <Button asChild size="sm" variant="outline">
            <Link to={`/loyalty/new?airlineId=${airlineId}`}>New program</Link>
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {isError ? (
          <p className="text-sm text-red-600">Could not load loyalty programs.</p>
        ) : isLoading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : programs.length === 0 ? (
          <p className="text-sm text-gray-500">No loyalty program points at this airline.</p>
        ) : (
          <Table aria-label="Loyalty programs">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead className="w-20 text-right">Tiers</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {programs.map(program => (
                <TableRow key={program.id}>
                  <TableCell>
                    <Link to={`/data/loyalty-programs/${program.id}`} className="text-blue-600 hover:underline">
                      {programName(program)}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{program.code ?? '—'}</TableCell>
                  <TableCell>{kindName(program.kind)}</TableCell>
                  <TableCell className="text-right">{program.tiers?.length ?? 0}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {/* Nothing to attach from a list that never arrived: an empty picker would read as
            "every program already has an airline", which is not what went wrong. */}
        {canAdd && <AttachProgram airlineId={airlineId} programs={unattached} kinds={kinds} />}
        {loaded && programs.length > 0 && (
          <p className="mt-4 border-t border-gray-100 pt-4 text-xs text-gray-500">
            An airline normally runs one program. Add another from the program itself, if it really has one.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * Points one program with no airline at this one. The update replaces the whole program, so the
 * program's own fields go back with it — and its kind has to go back as an id while the API only
 * ever hands the kind out as a code. A code the kinds table doesn't know can't be turned into an
 * id, and attaching anyway would save the program with no kind at all, so that one program is
 * refused here and left to its own page. The same guard the program form makes as kindUnresolved.
 */
function AttachProgram({ airlineId, programs, kinds }: {
  airlineId: number
  programs: LoyaltyProgramDto[]
  kinds?: LoyaltyProgramKind[]
}) {
  const [chosenId, setChosenId] = useState('')
  const [failure, setFailure] = useState<ReturnType<typeof apiErrorMessage>>()
  const update = useAdminUpdateLoyaltyProgram()

  const chosen = programs.find(p => String(p.id) === chosenId)
  const kindId = kinds?.find(k => k.code === chosen?.kind)?.id
  const kindUnresolved = chosen !== undefined && kinds !== undefined && kindId === undefined

  const options: ComboboxOption[] = programs.map(program => ({
    value: String(program.id),
    label: `${programName(program)} (${program.code ?? program.id})`,
    // A program is as often known by its code as by its name; both search, one shows.
    keywords: program.code ?? '',
  }))

  const attach = () => {
    if (!chosen?.id || kindId === undefined) return
    setFailure(undefined)
    update.mutate(
      {
        id: chosen.id,
        data: {
          code: chosen.code,
          name: chosen.name,
          kindId,
          airlineId,
        },
      },
      {
        onSuccess: () => setChosenId(''),
        // The choice stays on screen: the attach can be tried again without finding the program afresh.
        onError: error => setFailure(apiErrorMessage(error)),
      },
    )
  }

  return (
    <div className="mt-4 space-y-2 border-t border-gray-100 pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-56 flex-1">
          <Combobox
            id={`attach-program-${airlineId}`}
            ariaLabel="Attach a program"
            searchLabel="Search loyalty programs"
            searchPlaceholder="e.g. miles, EXEC_CLUB"
            placeholder="Choose a program with no airline…"
            value={chosenId}
            onChange={next => {
              setFailure(undefined)
              setChosenId(next)
            }}
            options={options}
            emptyMessage="Every loyalty program already has an airline."
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={attach}
          disabled={!chosen || kindUnresolved || update.isPending}
        >
          {update.isPending ? 'Attaching…' : 'Attach'}
        </Button>
      </div>

      {kindUnresolved && (
        <p className="text-xs text-amber-600">
          {`This program's kind "${chosen?.kind}" isn't in the kinds list, so it can't be attached from here. Open the program and set its kind first.`}
        </p>
      )}

      {failure && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <p>{`Could not attach this program: ${failure.title}`}</p>
          {failure.detail && <p className="mt-1 text-xs text-red-600">{failure.detail}</p>}
        </div>
      )}
    </div>
  )
}
