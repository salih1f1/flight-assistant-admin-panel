import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AirlineName } from '@/components/ReferenceNames'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAdminCreateLoyaltyProgram, useAdminUpdateLoyaltyProgram } from '@/api/generated/admin'
import { useLoyaltyProgram, useLoyaltyProgramKinds } from '@/api/loyaltyLookups'
import { invalidateLoyaltyPrograms } from '@/api/cache'
import { optionalInt } from '@/lib/formNumbers'

const schema = z.object({
  code: z.string().min(1, 'Required'),
  name: z.string().min(1, 'Required'),
  // An unselected kind coerces to 0 and fails here, so the form never submits
  // a kind the admin did not choose.
  kindId: z.coerce.number().int().min(1, 'Choose a kind'),
  airlineId: optionalInt(),
  allianceCode: z.string().optional(),
})

// The form holds raw input values (coerced fields are `unknown` until parsed);
// handleSubmit receives the parsed output.
type FormInput = z.input<typeof schema>
type FormData = z.output<typeof schema>

export function LoyaltyProgramFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = id !== 'new' && id !== undefined
  const navigate = useNavigate()

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">{isEdit ? 'Edit loyalty program' : 'New loyalty program'}</h1>
      <LoyaltyProgramForm id={isEdit ? Number(id) : undefined} onDone={() => navigate('/data/loyalty-programs')} />
    </div>
  )
}

/**
 * The loyalty program form: edits loyalty program `id`, or creates one when there's no id. `onDone` runs after a
 * successful save and on Cancel, so the page around it decides where the admin goes next.
 */
export function LoyaltyProgramForm({ id, onDone }: { id?: number; onDone: () => void }) {
  const isEdit = id !== undefined
  const queryClient = useQueryClient()
  const { data: existing } = useLoyaltyProgram(id)
  const { data: kinds, isError: kindsFailed } = useLoyaltyProgramKinds()
  const createMutation = useAdminCreateLoyaltyProgram({ mutation: { onSuccess: () => invalidateLoyaltyPrograms(queryClient) } })
  const updateMutation = useAdminUpdateLoyaltyProgram({ mutation: { onSuccess: () => invalidateLoyaltyPrograms(queryClient) } })

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<FormInput, unknown, FormData>({
    resolver: zodResolver(schema),
  })

  // The API sends a program's kind as its code, while saving needs the kind's id.
  const kindUnresolved = !!existing && !!kinds && !kinds.some(k => k.code === existing.kind)

  useEffect(() => {
    // Waits for the kinds as well as the program, so the kind can be matched.
    if (existing && kinds) reset({
      code: existing.code ?? '',
      name: existing.name ?? '',
      // No fallback: an unmatched kind stays unselected, so the admin must pick
      // one rather than the form silently saving a different kind.
      kindId: kinds.find(k => k.code === existing.kind)?.id,
      airlineId: existing.airlineId ?? undefined,
      allianceCode: existing.allianceCode ?? '',
    })
  }, [existing, kinds, reset])

  const onSubmit = (data: FormData) => {
    const payload = { ...data, allianceCode: data.allianceCode || undefined }
    if (id !== undefined) {
      updateMutation.mutate({ id, data: payload }, { onSuccess: () => onDone() })
    } else {
      createMutation.mutate({ data: payload }, { onSuccess: () => onDone() })
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Program details</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Code <span className="text-red-500">*</span></Label>
              <Input {...register('code')} placeholder="e.g. EXEC_CLUB" />
              {errors.code && <p className="text-xs text-red-500">{errors.code.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="kindId">Kind <span className="text-red-500">*</span></Label>
              <select
                id="kindId"
                {...register('kindId')}
                className="flex h-10 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
              >
                <option value="">Choose a kind…</option>
                {kinds?.map(k => (
                  <option key={k.id} value={k.id}>{k.name} ({k.code})</option>
                ))}
              </select>
              {errors.kindId && <p className="text-xs text-red-500">{errors.kindId.message}</p>}
              {kindsFailed && <p className="text-xs text-red-500">Could not load loyalty program kinds.</p>}
              {kindUnresolved && (
                <p className="text-xs text-amber-600">
                  This program's kind "{existing?.kind}" isn't in the kinds list. Choose its kind before saving.
                </p>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Name <span className="text-red-500">*</span></Label>
            <Input {...register('name')} />
            {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Airline ID</Label>
              <Input type="number" {...register('airlineId')} placeholder="optional" />
              {/* Which airline the number is, looked up as it's typed. */}
              {Number(watch('airlineId')) > 0 && (
                <p className="text-xs text-gray-500"><AirlineName id={Number(watch('airlineId'))} /></p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Alliance code</Label>
              <Input {...register('allianceCode')} placeholder="STAR / OW / ST" />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
              {isEdit ? 'Save changes' : 'Create program'}
            </Button>
            <Button type="button" variant="outline" onClick={() => onDone()}>Cancel</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
