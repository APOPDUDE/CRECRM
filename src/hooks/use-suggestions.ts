import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export type Suggestion = {
  id: string
  created_at: string
  property:
    | {
        id: string
        address: string
        city: string | null
        state: string | null
        property_type: string | null
        building_sf: number | null
        asking_rate_psf: number | null
        asking_price: number | null
        listing_url: string | null
        source_url: string | null
      }
    | null
  tenant_rep:
    | {
        id: string
        company: { name: string } | null
        contact: { first_name: string; last_name: string | null } | null
      }
    | null
}

const SUGGESTION_SELECT = `
  id, created_at,
  property:properties!match_suggestions_property_id_fkey(id, address, city, state, property_type, building_sf, asking_rate_psf, asking_price, listing_url, source_url),
  tenant_rep:tenant_reps!match_suggestions_tenant_rep_id_fkey(
    id,
    company:companies!tenant_reps_tenant_company_id_fkey(name),
    contact:contacts!tenant_reps_tenant_contact_id_fkey(first_name, last_name)
  )
`

/** Pending property suggestions from the daily sweep, newest first. */
export function usePendingSuggestions() {
  return useQuery({
    queryKey: ['suggestions', 'pending'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('match_suggestions')
        .select(SUGGESTION_SELECT)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as unknown as Suggestion[]
    },
  })
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['suggestions'] })
  qc.invalidateQueries({ queryKey: ['matches'] })
  qc.invalidateQueries({ queryKey: ['tenant_reps'] })
}

/** Approve a suggestion → creates the inquiring match on the tenant's board. */
export function useApproveSuggestion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('approve_match_suggestion', { p_suggestion_id: id })
      if (error) throw error
    },
    onSuccess: () => invalidate(qc),
  })
}

/** Dismiss a suggestion (kept as 'dismissed' so the sweep won't re-suggest it). */
export function useDismissSuggestion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('match_suggestions')
        .update({ status: 'dismissed' })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => invalidate(qc),
  })
}
