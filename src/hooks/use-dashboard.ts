import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Enums } from '@/lib/database.types'

export type DashMatch = {
  id: string
  created_at: string
  inquiry_date: string | null
  tour_date: string | null
  loi_date: string | null
  lease_negotiation_date: string | null
  execution_date: string | null
  stage: Enums<'match_stage'>
  flagged_new: boolean
  tenant_rep_id: string | null
  listing_id: string | null
  property: { id: string; address: string; city: string | null; state: string | null } | null
  tenant_company: { name: string } | null
  tenant_contact: { first_name: string; last_name: string | null } | null
  tenant_rep: { actual_fee: number | null } | null
  listing: { actual_fee: number | null } | null
}

/** Matches with their stage dates + executed fees — powers the dashboard activity widgets. */
export function useDashboardMatches() {
  return useQuery({
    queryKey: ['dashboard-matches'],
    queryFn: async (): Promise<DashMatch[]> => {
      const { data, error } = await supabase
        .from('matches')
        .select(
          'id, created_at, inquiry_date, tour_date, loi_date, lease_negotiation_date, execution_date, stage, flagged_new, tenant_rep_id, listing_id, property:properties!matches_property_id_fkey(id, address, city, state), tenant_company:companies!matches_tenant_company_id_fkey(name), tenant_contact:contacts!matches_tenant_contact_id_fkey(first_name, last_name), tenant_rep:tenant_reps!matches_tenant_rep_id_fkey(actual_fee), listing:listings!matches_listing_id_fkey(actual_fee)',
        )
      if (error) throw error
      return (data ?? []) as unknown as DashMatch[]
    },
  })
}

/** Commission booked on an executed match — tenant-rep fee preferred, else the listing fee. */
export function matchFee(m: DashMatch): number {
  return m.tenant_rep?.actual_fee ?? m.listing?.actual_fee ?? 0
}
