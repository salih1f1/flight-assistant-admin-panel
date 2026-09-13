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
import { useAdminCreateAirline, useAdminGetAirlineById, useAdminUpdateAirline } from '@/api/generated/admin'
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
  const queryClient = useQueryClient()
  const { data: existing } = useAdminGetAirlineById(Number(id), { query: { enabled: isEdit } })
  const createMutation = useAdminCreateAirline({ mutation: { onSuccess: () => invalidateAirlines(queryClient) } })
  const updateMutation = useAdminUpdateAirline({
    mutation: { onSuccess: (_, variables) => invalidateAirlines(queryClient, variables.id) },
  })

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

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
    if (isEdit) {
      updateMutation.mutate({ id: Number(id), data: payload }, { onSuccess: () => navigate('/airlines') })
    } else {
      createMutation.mutate({ data: payload }, { onSuccess: () => navigate('/airlines') })
    }
  }

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">{isEdit ? 'Edit airline' : 'New airline'}</h1>
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
                <Input id="allianceCode" {...register('allianceCode')} placeholder="STAR / OW / ST" />
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                {isEdit ? 'Save changes' : 'Create airline'}
              </Button>
              <Button type="button" variant="outline" onClick={() => navigate('/airlines')}>Cancel</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
