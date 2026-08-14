import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Tables, TablesInsert, TablesUpdate } from '@/lib/database.types'

export type Unit = Tables<'units'>

/**
 * A unit with the building's specs applied as fallbacks (from the `v_unit_specs` view).
 * A null spec on the unit means "same as the building", so the view resolves it and the
 * matching `*_inherited` flag says whether the value came from the suite or the building.
 * Resolution lives in Postgres so the app, the automations and a phone Claude chat all
 * agree on what a suite's clear height actually is.
 */
export type UnitSpecs = {
  unit_id: string
  property_id: string
  label: string | null
  size_sf: number | null
  size_acres: number | null
  asking_rate_psf: number | null
  status: string
  notes: string | null
  office_sf: number | null
  /** size_sf - office_sf; null unless both are known. */
  warehouse_sf: number | null
  dock_high_doors: number | null
  grade_level_doors: number | null
  dock_levelers: number | null
  clear_height_ft: number | null
  three_phase_power: boolean | null
  volts: string | null
  amps: number | null
  dock_high_doors_inherited: boolean
  grade_level_doors_inherited: boolean
  dock_levelers_inherited: boolean
  clear_height_ft_inherited: boolean
  three_phase_power_inherited: boolean
  volts_inherited: boolean
  amps_inherited: boolean
}

/** Units with building specs resolved in — use this wherever specs are displayed. */
export function useUnitSpecs(propertyIds: string[]) {
  const ids = Array.from(new Set(propertyIds.filter(Boolean)))
  return useQuery({
    queryKey: ['unit-specs', [...ids].sort().join(',')],
    enabled: ids.length > 0,
    queryFn: async (): Promise<UnitSpecs[]> => {
      const { data, error } = await supabase
        .from('v_unit_specs')
        .select('*')
        .in('property_id', ids)
      if (error) throw error
      return (data ?? []) as unknown as UnitSpecs[]
    },
  })
}


/**
 * Lettable space per property, from BOTH places it is known — hand-entered units
 * and the current on-market asking listing where it advertises less than the
 * whole building.
 *
 * Reads `v_property_available_space` rather than assembling it here, so n8n and
 * any future matcher get the same answer as this filter.
 *
 * The listing half is DERIVED, not copied into `units`: 178 of those 560 listings
 * have already changed their advertised size between scrapes, so a copy would be
 * right the day it was written and wrong after the next sweep.
 *
 * `.limit()` is explicit because a missing one truncates at 1000 silently, and
 * here that would read as "no space matches" rather than as an error.
 */
const AVAILABLE_SPACE_CAP = 5000

export function useAvailableUnitSizes() {
  return useQuery({
    queryKey: ['available-space'],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Map<string, number[]>> => {
      const { data, error } = await supabase
        .from('v_property_available_space')
        .select('property_id, size_sf')
        .not('size_sf', 'is', null)
        .limit(AVAILABLE_SPACE_CAP)
      if (error) throw error
      const rows = data ?? []
      if (rows.length >= AVAILABLE_SPACE_CAP) {
        console.warn(
          `available space truncated at ${AVAILABLE_SPACE_CAP} rows — the size filter is now incomplete`,
        )
      }
      const map = new Map<string, number[]>()
      for (const r of rows) {
        if (r.size_sf == null || r.property_id == null) continue
        const cur = map.get(r.property_id) ?? []
        cur.push(r.size_sf)
        map.set(r.property_id, cur)
      }
      return map
    },
  })
}

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
  qc.invalidateQueries({ queryKey: ['unit-specs'] })
}

/** Edit a unit — its size, rate, or any of its suite-level specs. */
export function useUpdateUnit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...values }: TablesUpdate<'units'> & { id: string }) => {
      const { data, error } = await supabase
        .from('units')
        .update(values)
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return data as Unit
    },
    onSuccess: () => invalidateUnits(qc),
  })
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
