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

// `!inner` on the client so the status filter excludes suggestions whose client has
// left the active repping pool. (alias kept as `tenant_rep` for the widget.)
const SUGGESTION_SELECT = `
  id, created_at,
  property:properties!suggestions_property_id_fkey(id, address, city, state, property_type, building_sf, asking_rate_psf, asking_price, listing_url),
  tenant_rep:clients!suggestions_client_id_fkey!inner(
    id,
    company:companies!clients_company_id_fkey(name),
    contact:contacts!clients_contact_id_fkey(first_name, last_name)
  )
`

/** Pending suggestions for clients still actively being repped, newest first. */
export function usePendingSuggestions() {
  return useQuery({
    queryKey: ['suggestions', 'pending'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('suggestions')
        .select(SUGGESTION_SELECT)
        .eq('status', 'pending')
        .eq('tenant_rep.status', 'active')
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

/** Approve a suggestion -> creates the inquiring pursuit on the client's board. */
export function useApproveSuggestion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('approve_suggestion', { p_suggestion_id: id })
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
        .from('suggestions')
        .update({ status: 'dismissed' })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => invalidate(qc),
  })
}
