import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  useAdminCreateAirline, useAdminGetAirlineById, useAdminGetAllAlliances, useAdminUpdateAirline,
} from '@/api/generated/admin'
import { invalidateAirlines } from '@/api/cache'

const schema = z.object({
  iata: z.string().max(3).optional(),
  icao: z.string().max(4).optional(),
  name: z.string().min(1, 'Name is required'),
  countryCode: z.string().length(2, 'Must be 2-letter ISO code'),
  allianceCode: z.string().optional(),
})

type FormData = z.infer<typeof schema>

export function AirlineFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = id !== 'new' && id !== undefined
  const navigate = useNavigate()

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">{isEdit ? 'Edit airline' : 'New airline'}</h1>
      <AirlineForm id={isEdit ? Number(id) : undefined} onDone={() => navigate('/data/airlines')} />
    </div>
  )
}

/**
 * The airline form: edits airline `id`, or creates one when there's no id. `onDone` runs after a
 * successful save and on Cancel, so the page around it decides where the admin goes next.
 */
export function AirlineForm({ id, onDone }: { id?: number; onDone: () => void }) {
  const isEdit = id !== undefined
  const queryClient = useQueryClient()
  const { data: existing } = useAdminGetAirlineById(id ?? 0, { query: { enabled: isEdit } })
  const { data: alliances, isError: alliancesFailed } = useAdminGetAllAlliances()
  const createMutation = useAdminCreateAirline({ mutation: { onSuccess: () => invalidateAirlines(queryClient) } })
  const updateMutation = useAdminUpdateAirline({
    mutation: { onSuccess: (_, variables) => invalidateAirlines(queryClient, variables.id) },
  })

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  const chosen = watch('allianceCode')
  // The select needs an option for whatever the airline already holds, or it has nothing to show
  // that value with and falls back to "No alliance" — and saving any other field would then
  // silently clear the airline's alliance. That applies while the list is still loading and when
  // it failed, not only to a code the API genuinely dropped.
  const missingOption = chosen && !alliances?.some(a => a.code === chosen) ? chosen : undefined
  // Only a list that actually arrived is evidence a code is unlisted; a loading or failed one is not.
  const unlisted = alliances ? missingOption : undefined

  useEffect(() => {
    // The spec marks every field nullable, so even name and countryCode are defaulted.
    if (existing) reset({
      iata: existing.iata ?? '',
      icao: existing.icao ?? '',
      name: existing.name ?? '',
      countryCode: existing.countryCode ?? '',
      allianceCode: existing.allianceCode ?? '',
    })
  }, [existing, reset])

  const onSubmit = (data: FormData) => {
    const payload = { name: data.name, countryCode: data.countryCode, iata: data.iata || undefined, icao: data.icao || undefined, allianceCode: data.allianceCode || undefined }
    if (id !== undefined) {
      updateMutation.mutate({ id, data: payload }, { onSuccess: () => onDone() })
    } else {
      createMutation.mutate({ data: payload }, { onSuccess: () => onDone() })
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Airline details</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="iata">IATA code</Label>
              <Input id="iata" {...register('iata')} placeholder="e.g. BA" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="icao">ICAO code</Label>
              <Input id="icao" {...register('icao')} placeholder="e.g. BAW" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="name">Name <span className="text-red-500">*</span></Label>
            <Input id="name" {...register('name')} />
            {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="countryCode">Country code <span className="text-red-500">*</span></Label>
              <Input id="countryCode" {...register('countryCode')} placeholder="e.g. GB" maxLength={2} />
              {errors.countryCode && <p className="text-xs text-red-500">{errors.countryCode.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="allianceCode">Alliance</Label>
              <select
                id="allianceCode"
                {...register('allianceCode')}
                className="flex h-10 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
              >
                <option value="">No alliance</option>
                {missingOption && <option value={missingOption}>{missingOption}</option>}
                {alliances?.map(a => (
                  <option key={a.code} value={a.code ?? ''}>{a.name} ({a.code})</option>
                ))}
              </select>
              {alliancesFailed && <p className="text-xs text-red-500">Could not load alliances.</p>}
              {unlisted && (
                <p className="text-xs text-amber-600">
                  "{unlisted}" isn't in the alliances list. Saving keeps it; pick another to replace it.
                </p>
              )}
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
              {isEdit ? 'Save changes' : 'Create airline'}
            </Button>
            <Button type="button" variant="outline" onClick={() => onDone()}>Cancel</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
