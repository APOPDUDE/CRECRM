import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Tables } from '@/lib/database.types'

export type PropertyPoint = {
  id: string
  address: string
  city: string | null
  state: string | null
  lat: number | null
  lng: number | null
}

/**
 * Address search that returns coordinates, for the Buyers page's "who buys here?" check:
 * pick the property a deal just landed on, and the roster narrows to the buyers whose
 * drawn areas contain it.
 */
export function usePropertyPointSearch(query: string) {
  const q = query.replace(/[,()]/g, ' ').trim()
  return useQuery({
    queryKey: ['buyer-property-search', q],
    enabled: q.length >= 3,
    queryFn: async (): Promise<PropertyPoint[]> => {
      const { data, error } = await supabase
        .from('properties')
        .select('id, address, city, state, lat, lng')
        .ilike('address', `%${q}%`)
        .order('address')
        .limit(8)
      if (error) throw error
      return (data ?? []) as PropertyPoint[]
    },
  })
}

export type BuyerIntake = Tables<'buyer_intakes'>

/**
 * People tagged "buyer" in GHL who aren't buyers in the CRM yet. Tagging is one tap on a
 * phone, so it queues rather than creating a client — nothing reaches the roster, the blast
 * lists or the matching engine until the criteria are filled in here.
 */
export function usePendingBuyerIntakes() {
  return useQuery({
    queryKey: ['buyer_intakes', 'pending'],
    queryFn: async (): Promise<BuyerIntake[]> => {
      const { data, error } = await supabase
        .from('buyer_intakes')
        .select('*')
        .eq('status', 'pending')
        .order('tagged_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
  })
}

/** Link the queue entry to the client the buyer form just created. */
export function useApproveBuyerIntake() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ intakeId, clientId }: { intakeId: string; clientId: string }) => {
      const { error } = await supabase.rpc('approve_buyer_intake', {
        p_intake_id: intakeId,
        p_client_id: clientId,
      })
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['buyer_intakes'] }),
  })
}

/** Not a buyer after all (mistag, duplicate, wrong person) — take them off the strip. */
export function useDismissBuyerIntake() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ intakeId, reason }: { intakeId: string; reason?: string }) => {
      const { error } = await supabase.rpc('dismiss_buyer_intake', {
        p_intake_id: intakeId,
        p_reason: reason ?? undefined,
      })
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['buyer_intakes'] }),
  })
}
