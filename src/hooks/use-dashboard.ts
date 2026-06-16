import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Enums } from '@/lib/database.types'

export type DashMatch = {
  id: string
  created_at: string
  inquiry_date: string | null
  tour_date: string | null
  executed_date: string | null
  stage: Enums<'pursuit_stage'>
  flagged_new: boolean
  actual_fee: number | null
  /** alias of client_id, for routing to the tenant board */
  tenant_rep_id: string | null
  property: { id: string; address: string; city: string | null; state: string | null } | null
  tenant_company: { name: string } | null
  tenant_contact: { first_name: string; last_name: string | null } | null
}

type PursuitDashRow = {
  id: string
  created_at: string
  inquiry_date: string | null
  tour_date: string | null
  executed_date: string | null
  stage: Enums<'pursuit_stage'>
  flagged_new: boolean
  actual_fee: number | null
  client_id: string | null
  property: { id: string; address: string; city: string | null; state: string | null } | null
  client: {
    company: { name: string } | null
    contact: { first_name: string; last_name: string | null } | null
  } | null
}

/** Pursuits with their stage dates + executed fees — powers the dashboard activity widgets. */
export function useDashboardMatches() {
  return useQuery({
    queryKey: ['dashboard-matches'],
    queryFn: async (): Promise<DashMatch[]> => {
      const { data, error } = await supabase
        .from('pursuits')
        .select(
          'id, created_at, inquiry_date, tour_date, executed_date, stage, flagged_new, actual_fee, client_id, property:properties!pursuits_property_id_fkey(id, address, city, state), client:clients!pursuits_client_id_fkey(company:companies!clients_company_id_fkey(name), contact:contacts!clients_contact_id_fkey(first_name, last_name))',
        )
      if (error) throw error
      return ((data ?? []) as unknown as PursuitDashRow[]).map((p) => ({
        id: p.id,
        created_at: p.created_at,
        inquiry_date: p.inquiry_date,
        tour_date: p.tour_date,
        executed_date: p.executed_date,
        stage: p.stage,
        flagged_new: p.flagged_new,
        actual_fee: p.actual_fee,
        tenant_rep_id: p.client_id,
        property: p.property,
        tenant_company: p.client?.company ?? null,
        tenant_contact: p.client?.contact ?? null,
      }))
    },
  })
}

/** Commission booked on an executed pursuit. */
export function matchFee(m: DashMatch): number {
  return m.actual_fee ?? 0
}
