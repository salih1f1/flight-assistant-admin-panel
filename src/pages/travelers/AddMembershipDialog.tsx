import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Combobox, type ComboboxOption } from '@/components/ui/combobox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAdminAddMembershipForTraveler } from '@/api/generated/admin'
import type { LoyaltyProgramDto } from '@/api/generated/model'
import { useLoyaltyPrograms } from '@/api/loyaltyLookups'
import { invalidateLoyaltyMemberships } from '@/api/cache'
import { apiErrorMessage } from '@/lib/apiError'
import { optionalInt } from '@/lib/formNumbers'

// AddLoyaltyMembershipCommandValidator: AccountNumber is required and at most 64 characters.
const MAX_ACCOUNT_NUMBER = 64

const schema = z.object({
  // An unchosen program coerces to 0 and fails here, so the form never posts a program
  // nobody picked — the API would refuse it with a 409 anyway.
  programId: z.coerce.number().int().min(1, 'Choose a program'),
  tierId: optionalInt(),
  accountNumber: z.string().trim().min(1, 'Required').max(MAX_ACCOUNT_NUMBER, `At most ${MAX_ACCOUNT_NUMBER} characters`),
  tierExpiryDate: z.string().optional(),
})

// The form holds raw input values (coerced fields are `unknown` until parsed);
// handleSubmit receives the parsed output.
type FormInput = z.input<typeof schema>
type FormData = z.output<typeof schema>

const EMPTY: FormInput = { programId: '', tierId: '', accountNumber: '', tierExpiryDate: '' }

const programLabel = (program: LoyaltyProgramDto) => `${program.name ?? `#${program.id}`} (${program.code ?? '—'})`

/**
 * Adds a loyalty membership to one traveler, program first and then that program's tier —
 * POST /admin/travelers/{id}/memberships, which files it under this traveler rather than the
 * signed-in admin. The tier list is the chosen program's own, so the pair can't be mismatched
 * here; the API refuses a mismatch with a 409 for anything that reaches it another way.
 */
export function AddMembershipDialog({ travelerId }: { travelerId: string }) {
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()
  const { data: programs, isLoading: programsLoading, isError: programsFailed } = useLoyaltyPrograms()
  const addMutation = useAdminAddMembershipForTraveler()
  const [failure, setFailure] = useState<ReturnType<typeof apiErrorMessage>>()

  const { register, handleSubmit, reset, setValue, watch, formState: { errors } } = useForm<FormInput, unknown, FormData>({
    resolver: zodResolver(schema),
    defaultValues: EMPTY,
  })

  const programId = Number(watch('programId'))
  const program = programs?.find(p => p.id === programId)
  // Rank orders a program's tiers from entry level upwards; the API doesn't promise that order.
  const tiers = [...(program?.tiers ?? [])].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))

  // A tier belongs to one program, so a tier chosen under the previous program is meaningless
  // once the program changes — dropped rather than posted against a program it isn't part of.
  useEffect(() => { setValue('tierId', '') }, [programId, setValue])

  const programOptions: ComboboxOption[] = (programs ?? []).map(p => ({
    value: String(p.id),
    label: programLabel(p),
    keywords: p.code ?? '',
  }))

  const onSubmit = (data: FormData) => {
    setFailure(undefined)
    addMutation.mutate(
      {
        id: travelerId,
        data: {
          programId: data.programId,
          ...(data.tierId === undefined ? {} : { tierId: data.tierId }),
          accountNumber: data.accountNumber,
          ...(data.tierExpiryDate ? { tierExpiryDate: data.tierExpiryDate } : {}),
        },
      },
      {
        onSuccess: () => {
          invalidateLoyaltyMemberships(queryClient, travelerId)
          setOpen(false)
        },
        onError: error => setFailure(apiErrorMessage(error)),
      },
    )
  }

  // Every open starts from a blank form: what was typed towards a membership that was cancelled,
  // or already added, is never the start of the next one.
  const change = (next: boolean) => {
    setOpen(next)
    if (next) {
      reset(EMPTY)
      setFailure(undefined)
    }
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <Button variant="outline" size="sm" onClick={() => change(true)}>Add membership</Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add membership</DialogTitle>
          <DialogDescription>Adds a loyalty membership to this traveler, as if they had added it in the app.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="membership-program">Program <span className="text-red-500">*</span></Label>
            {/* The search sits inside the dropdown: 25 programs are too many to scroll, and a code
                like EXEC_CLUB or PP is in the middle of the label, where a native select's own
                type-ahead — which only matches the start — never reaches it. */}
            <Combobox
              id="membership-program"
              value={String(watch('programId') ?? '')}
              onChange={next => setValue('programId', next, { shouldValidate: true })}
              options={programOptions}
              placeholder="Choose a program…"
              searchLabel="Filter programs"
              searchPlaceholder="e.g. exec, miles, PP"
              emptyMessage={programsLoading ? 'Loading programs…' : 'Could not load loyalty programs.'}
              disabled={!programs}
            />
            {errors.programId && <p className="text-xs text-red-500">{errors.programId.message}</p>}
            {programsFailed && <p className="text-xs text-red-500">Could not load loyalty programs.</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="membership-tier">Tier</Label>
            <select id="membership-tier" {...register('tierId')} disabled={tiers.length === 0} className={SELECT_CLASS}>
              <option value="">No tier</option>
              {tiers.map(t => <option key={t.id} value={t.id}>{`${t.name ?? `#${t.id}`} (${t.code ?? '—'})`}</option>)}
            </select>
            {program && tiers.length === 0 && <p className="text-xs text-gray-500">{`${program.name ?? `Program #${program.id}`} has no tiers.`}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="membership-account">Account number <span className="text-red-500">*</span></Label>
            <Input id="membership-account" {...register('accountNumber')} placeholder="e.g. BA-12345678" />
            {errors.accountNumber && <p className="text-xs text-red-500">{errors.accountNumber.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="membership-tier-expiry">Tier expiry</Label>
            <Input id="membership-tier-expiry" type="date" {...register('tierExpiryDate')} />
          </div>

          {/* The API's own words: a 409 for a program or tier it doesn't have, a 400 for a past expiry date. */}
          {failure && (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <p>{failure.title}</p>
              {failure.detail && <p className="mt-1 text-xs text-red-600">{failure.detail}</p>}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => change(false)} disabled={addMutation.isPending}>Cancel</Button>
            <Button type="submit" disabled={addMutation.isPending}>{addMutation.isPending ? 'Adding…' : 'Add membership'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// Matches the native selects on the reference-data forms (LoyaltyProgramFormPage).
const SELECT_CLASS =
  'flex h-10 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm ring-offset-white ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ' +
  'disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400'
