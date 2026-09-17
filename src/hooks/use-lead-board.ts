import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Enums, Tables } from '@/lib/database.types'

/**
 * Where each live lead sits on the Leads board, straight from `v_lead_board`.
 *
 * New / Booked / Prep / Met are DERIVED in Postgres from the Calendly meeting on the lead
 * (see the `lead_board_stage` function), so the board is correct every morning without
 * anyone dragging anything. Only Reschedule / Client / Unqualified are stored decisions.
 */
export type LeadBoardRow = Tables<'v_lead_board'>

export type LeadStage =
  | 'dead'
  | 'new'
  | 'booked'
  | 'prep'
  | 'met'
  | 'reschedule'
  | 'client'
  | 'unqualified'

/** The columns that are a decision, so dropping into them writes. The rest are time-driven. */
export const MANUAL_STAGES = ['reschedule', 'client', 'unqualified'] as const

export function isManualStage(s: LeadStage): s is Enums<'lead_manual_stage'> {
  return (MANUAL_STAGES as readonly string[]).includes(s)
}

export function useLeadBoard() {
  return useQuery({
    queryKey: ['lead_board'],
    queryFn: async (): Promise<LeadBoardRow[]> => {
      const { data, error } = await supabase.from('v_lead_board').select('*').limit(1000)
      if (error) throw error
      return data ?? []
    },
    // The derived columns move with the clock, so don't serve a stale board all day.
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  })
}

/**
 * Move a lead. Dropping it back into a time-driven column clears the manual stage, which
 * hands it back to the meeting date rather than pinning it somewhere wrong.
 *
 * Dead is the lifecycle flag on `prospects.status`, not a manual stage, so it is written
 * separately — and only touched when the lead is actually entering or leaving Dead, so
 * dragging a converted lead around never quietly reopens it.
 */
export function useSetLeadStage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      stage,
      fromDead,
    }: {
      id: string
      stage: LeadStage
      fromDead?: boolean
    }) => {
      const patch: { manual_stage?: Enums<'lead_manual_stage'> | null; status?: 'open' | 'dead' } = {}
      if (stage === 'dead') {
        patch.status = 'dead'
      } else {
        patch.manual_stage = isManualStage(stage) ? stage : null
        if (fromDead) patch.status = 'open'
      }
      const { error } = await supabase.from('prospects').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead_board'] })
      queryClient.invalidateQueries({ queryKey: ['prospects'] })
    },
  })
}

export function useSetLeadTemperature() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, temperature }: { id: string; temperature: Enums<'lead_temperature'> | null }) => {
      const { error } = await supabase.from('prospects').update({ temperature }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead_board'] })
      queryClient.invalidateQueries({ queryKey: ['prospects'] })
    },
  })
}
