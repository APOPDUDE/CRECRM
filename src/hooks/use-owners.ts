import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Tables } from '@/lib/database.types'

export type OwnerContext = Tables<'v_property_owner_context'>
export type Owner = Tables<'owners'>
export type Communication = Tables<'communications'>

/**
 * Per-property owner context, keyed by property id.
 *
 * One row per property (the view already rolls up portfolio size, contact counts and
 * last-conversation recency), so the map and list can filter on "do we have a verified
 * owner contact" without a second round trip per pin.
 */
export function useOwnerContext() {
  return useQuery({
    queryKey: ['owner-context'],
    staleTime: 60_000,
    queryFn: async () => {
      // PostgREST caps a response at 1000 rows and there are ~7,700 properties.
      const PAGE = 1000
      const map = new Map<string, OwnerContext>()
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from('v_property_owner_context')
          .select('*')
          .order('property_id')
          .range(from, from + PAGE - 1)
        if (error) throw error
        const rows = (data ?? []) as OwnerContext[]
        for (const r of rows) if (r.property_id) map.set(r.property_id, r)
        if (rows.length < PAGE) break
      }
      return map
    },
  })
}

/** Every property an owner holds — the portfolio view behind a map pin. */
export function useOwnerProperties(ownerId: string | null | undefined) {
  return useQuery({
    queryKey: ['owner-properties', ownerId],
    enabled: !!ownerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('properties')
        .select('id, address, city, county, property_type, building_sf, land_acres, listing_status, lat, lng')
        .eq('owner_id', ownerId!)
        .order('address')
      if (error) throw error
      return data ?? []
    },
  })
}

export type OwnerContactRow = Tables<'owner_contacts'> & {
  contact: Pick<
    Tables<'contacts'>,
    'id' | 'first_name' | 'last_name' | 'phone' | 'email' | 'title' | 'do_not_call' | 'campaign_lists'
  > | null
}

/** The humans linked to an owner, best-verified first. */
export function useOwnerContacts(ownerId: string | null | undefined) {
  return useQuery({
    queryKey: ['owner-contacts', ownerId],
    enabled: !!ownerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('owner_contacts')
        .select(
          '*, contact:contacts!owner_contacts_contact_id_fkey(id, first_name, last_name, phone, email, title, do_not_call, campaign_lists)',
        )
        .eq('owner_id', ownerId!)
      if (error) throw error
      const rows = (data ?? []) as unknown as OwnerContactRow[]
      const rank = { confirmed: 0, likely: 1, unconfirmed: 2 } as const
      return rows.sort((a, b) => rank[a.confidence] - rank[b.confidence])
    },
  })
}

/**
 * Conversation history for an owner: everything logged against the owner itself, plus
 * anything logged against the humans we've linked to it. Newest first.
 */
export function useOwnerConversations(ownerId: string | null | undefined, contactIds: string[]) {
  const key = [...contactIds].sort().join(',')
  return useQuery({
    queryKey: ['owner-conversations', ownerId, key],
    enabled: !!ownerId,
    queryFn: async () => {
      const clauses = [`owner_id.eq.${ownerId}`]
      if (contactIds.length > 0) clauses.push(`contact_id.in.(${contactIds.join(',')})`)
      const { data, error } = await supabase
        .from('communications')
        .select('*')
        .or(clauses.join(','))
        .order('occurred_at', { ascending: false })
        .limit(200)
      if (error) throw error
      return (data ?? []) as Communication[]
    },
  })
}
