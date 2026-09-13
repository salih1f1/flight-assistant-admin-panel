import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAirport, useCreateAirport, useUpdateAirport } from '@/hooks/useAirports'

const schema = z.object({
  iata: z.string().length(3, 'Must be 3 letters'),
  icao: z.string().max(4).optional(),
  name: z.string().min(1, 'Required'),
  city: z.string().min(1, 'Required'),
  countryCode: z.string().length(2, 'Must be 2 letters'),
  latitude: z.coerce.number().optional(),
  longitude: z.coerce.number().optional(),
  elevationFt: z.coerce.number().int().optional(),
})

// The form holds raw input values (coerced fields are `unknown` until parsed);
// handleSubmit receives the parsed output.
type FormInput = z.input<typeof schema>
type FormData = z.output<typeof schema>

export function AirportFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = id !== 'new' && id !== undefined
  const navigate = useNavigate()
  const { data: existing } = useAirport(isEdit ? Number(id) : -1)
  const createMutation = useCreateAirport()
  const updateMutation = useUpdateAirport()

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormInput, unknown, FormData>({
    resolver: zodResolver(schema),
  })

  useEffect(() => {
    if (existing) reset({ ...existing, icao: existing.icao ?? '' })
  }, [existing, reset])

  const onSubmit = (data: FormData) => {
    const payload = { ...data, icao: data.icao || undefined }
    if (isEdit) {
      updateMutation.mutate({ id: Number(id), data: payload }, { onSuccess: () => navigate('/airports') })
    } else {
      createMutation.mutate(payload, { onSuccess: () => navigate('/airports') })
    }
  }

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">{isEdit ? 'Edit airport' : 'New airport'}</h1>
      <Card>
        <CardHeader><CardTitle className="text-base">Airport details</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>IATA <span className="text-red-500">*</span></Label>
                <Input {...register('iata')} placeholder="e.g. LHR" maxLength={3} />
                {errors.iata && <p className="text-xs text-red-500">{errors.iata.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>ICAO</Label>
                <Input {...register('icao')} placeholder="e.g. EGLL" maxLength={4} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Name <span className="text-red-500">*</span></Label>
              <Input {...register('name')} />
              {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>City <span className="text-red-500">*</span></Label>
                <Input {...register('city')} />
              </div>
              <div className="space-y-1.5">
                <Label>Country code <span className="text-red-500">*</span></Label>
                <Input {...register('countryCode')} placeholder="GB" maxLength={2} />
                {errors.countryCode && <p className="text-xs text-red-500">{errors.countryCode.message}</p>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Latitude</Label>
                <Input type="number" step="any" {...register('latitude')} />
              </div>
              <div className="space-y-1.5">
                <Label>Longitude</Label>
                <Input type="number" step="any" {...register('longitude')} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Elevation (ft)</Label>
              <Input type="number" {...register('elevationFt')} />
            </div>
            <div className="flex gap-3 pt-2">
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                {isEdit ? 'Save changes' : 'Create airport'}
              </Button>
              <Button type="button" variant="outline" onClick={() => navigate('/airports')}>Cancel</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
