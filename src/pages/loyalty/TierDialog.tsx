import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAdminCreateLoyaltyTier, useAdminUpdateLoyaltyTier } from '@/api/generated/admin'
import type { LoyaltyTierDto } from '@/api/generated/model'
import { invalidateLoyaltyTiers } from '@/api/cache'
import { apiErrorMessage } from '@/lib/apiError'

// The lengths LoyaltyTierConfiguration gives the columns, which the API's validator enforces.
const MAX = { code: 24, name: 200, allianceCode: 8, allianceTierCode: 16 }

const schema = z.object({
  code: z.string().trim().min(1, 'Required').max(MAX.code, `At most ${MAX.code} characters`),
  name: z.string().trim().min(1, 'Required').max(MAX.name, `At most ${MAX.name} characters`),
  // Rank orders the program's tiers. It is required — the API refuses a negative one, and a
  // blank would otherwise coerce to 0 and silently claim the entry-level slot.
  rank: z.coerce.number().int().min(0, 'Rank must be 0 or more'),
  allianceCode: z.string().trim().max(MAX.allianceCode, `At most ${MAX.allianceCode} characters`).optional(),
  allianceTierCode: z.string().trim().max(MAX.allianceTierCode, `At most ${MAX.allianceTierCode} characters`).optional(),
})

// The form holds raw input values (coerced fields are `unknown` until parsed);
// handleSubmit receives the parsed output.
type FormInput = z.input<typeof schema>
type FormData = z.output<typeof schema>

const EMPTY: FormInput = { code: '', name: '', rank: '', allianceCode: '', allianceTierCode: '' }

const valuesOf = (tier: LoyaltyTierDto): FormInput => ({
  code: tier.code ?? '',
  name: tier.name ?? '',
  rank: tier.rank ?? '',
  allianceCode: tier.allianceCode ?? '',
  allianceTierCode: tier.allianceTierCode ?? '',
})

/**
 * Adds a tier to a loyalty program, or edits one of its tiers when `tier` is given — one tier per
 * confirm, so a refusal names the tier that was refused. `open` and `onOpenChange` are the caller's,
 * since the same dialog serves the section's Add button and every row's Edit.
 */
export function TierDialog({ programId, tier, open, onOpenChange }: {
  programId: number
  tier?: LoyaltyTierDto
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const isEdit = tier !== undefined
  const queryClient = useQueryClient()
  const createMutation = useAdminCreateLoyaltyTier()
  const updateMutation = useAdminUpdateLoyaltyTier()
  const [failure, setFailure] = useState<ReturnType<typeof apiErrorMessage>>()

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormInput, unknown, FormData>({
    resolver: zodResolver(schema),
    defaultValues: EMPTY,
  })

  // Every open starts from the tier being edited, or from blank: what was typed towards a tier
  // that was cancelled, or already saved, is never the start of the next one.
  useEffect(() => {
    if (!open) return
    reset(tier ? valuesOf(tier) : EMPTY)
    setFailure(undefined)
  }, [open, tier, reset])

  const pending = createMutation.isPending || updateMutation.isPending

  const onSubmit = (data: FormData) => {
    setFailure(undefined)
    const body = {
      code: data.code,
      name: data.name,
      rank: data.rank,
      // The API takes these as nullable; a blank field means "not set", not an empty string.
      allianceCode: data.allianceCode || undefined,
      allianceTierCode: data.allianceTierCode || undefined,
    }
    const options = {
      onSuccess: () => {
        invalidateLoyaltyTiers(queryClient)
        onOpenChange(false)
      },
      // A clash with another tier of the program is a 409 the API raises on purpose: shown here,
      // with the dialog left open, so the admin can change the code or rank and try again.
      onError: (error: unknown) => setFailure(apiErrorMessage(error)),
    }

    if (isEdit) updateMutation.mutate({ programId, tierId: tier.id!, data: body }, options)
    else createMutation.mutate({ programId, data: body }, options)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit tier' : 'Add tier'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Changes this tier of the program. Travelers on it keep their membership.'
              : 'Adds a tier to this loyalty program.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="tier-code">Code <span className="text-red-500">*</span></Label>
              <Input id="tier-code" {...register('code')} placeholder="e.g. GOLD" />
              {errors.code && <p className="text-xs text-red-500">{errors.code.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tier-rank">Rank <span className="text-red-500">*</span></Label>
              <Input id="tier-rank" type="number" {...register('rank')} placeholder="e.g. 3" />
              {errors.rank && <p className="text-xs text-red-500">{errors.rank.message}</p>}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tier-name">Name <span className="text-red-500">*</span></Label>
            <Input id="tier-name" {...register('name')} placeholder="e.g. Gold" />
            {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="tier-alliance-code">Alliance code</Label>
              <Input id="tier-alliance-code" {...register('allianceCode')} placeholder="STAR / OW / ST" />
              {errors.allianceCode && <p className="text-xs text-red-500">{errors.allianceCode.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tier-alliance-tier-code">Alliance tier code</Label>
              <Input id="tier-alliance-tier-code" {...register('allianceTierCode')} placeholder="e.g. *G" />
              {errors.allianceTierCode && <p className="text-xs text-red-500">{errors.allianceTierCode.message}</p>}
            </div>
          </div>

          {/* The API's own words: a 409 when the program already has that code or rank. */}
          {failure && (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <p>{failure.title}</p>
              {failure.detail && <p className="mt-1 text-xs text-red-600">{failure.detail}</p>}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save tier'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
