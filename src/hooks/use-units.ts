import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Tables, TablesInsert } from '@/lib/database.types'

export type Unit = Tables<'units'>

export const unitsKey = (propertyIds: string[]) => ['units', [...propertyIds].sort().join(',')]

/**
 * Available units (sub-spaces) across one or more properties — powers the landlord-deal
 * "Available units" section (union across the assemblage's parcels) and the prospect form.
 */
export function useUnits(propertyIds: string[]) {
  const ids = Array.from(new Set(propertyIds.filter(Boolean)))
  return useQuery({
    queryKey: unitsKey(ids),
    enabled: ids.length > 0,
    queryFn: async (): Promise<Unit[]> => {
      const { data, error } = await supabase
        .from('units')
        .select('*')
        .in('property_id', ids)
        .order('created_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as Unit[]
    },
  })
}

function invalidateUnits(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['units'] })
}

export function useCreateUnit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (values: TablesInsert<'units'>) => {
      const { data, error } = await supabase.from('units').insert(values).select().single()
      if (error) throw error
      return data as Unit
    },
    onSuccess: () => invalidateUnits(qc),
  })
}

export function useDeleteUnit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('units').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => invalidateUnits(qc),
  })
}

/** The unit(s) a prospect inquired on — shown on the match slide-over. */
export function usePursuitUnits(pursuitId: string | undefined) {
  return useQuery({
    queryKey: ['pursuit-units', pursuitId],
    enabled: !!pursuitId,
    queryFn: async (): Promise<Unit[]> => {
      const { data, error } = await supabase
        .from('pursuit_units')
        .select('unit:units!pursuit_units_unit_id_fkey(*)')
        .eq('pursuit_id', pursuitId!)
      if (error) throw error
      return ((data ?? []) as unknown as { unit: Unit | null }[])
        .map((r) => r.unit)
        .filter((u): u is Unit => !!u)
    },
  })
}

/** Replace the set of units a pursuit is tied to (used by the add-prospect form). */
export function useSetPursuitUnits() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ pursuitId, unitIds }: { pursuitId: string; unitIds: string[] }) => {
      await supabase.from('pursuit_units').delete().eq('pursuit_id', pursuitId)
      if (unitIds.length > 0) {
        const rows = unitIds.map((unit_id) => ({ pursuit_id: pursuitId, unit_id }))
        const { error } = await supabase.from('pursuit_units').insert(rows)
        if (error) throw error
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pursuit-units'] }),
  })
}

/** Format a unit's size as "2,000 SF" / "1.5 AC" / both. */
export function unitSizeLabel(u: Pick<Unit, 'size_sf' | 'size_acres'>): string {
  const parts: string[] = []
  if (u.size_sf != null) parts.push(`${u.size_sf.toLocaleString()} SF`)
  if (u.size_acres != null) parts.push(`${u.size_acres} AC`)
  return parts.join(' · ') || '—'
}
