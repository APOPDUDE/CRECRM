import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      // ~13k rows behind PostgREST's 1000-row cap — fetch the pages in parallel; serial
      // paging plus a zero staleTime is what made back-navigation to the map crawl.
      const PAGE = 1000
      const base = () =>
        supabase.from('v_property_owner_context').select('*', { count: 'exact' }).order('property_id')
      const first = await base().range(0, PAGE - 1)
      if (first.error) throw first.error
      const total = first.count ?? (first.data?.length ?? 0)
      const rest = await Promise.all(
        Array.from({ length: Math.max(0, Math.ceil(total / PAGE) - 1) }, (_, i) =>
          base().range((i + 1) * PAGE, (i + 2) * PAGE - 1),
        ),
      )
      const map = new Map<string, OwnerContext>()
      for (const r of [first, ...rest]) {
        if (r.error) throw r.error
        for (const row of (r.data ?? []) as OwnerContext[]) {
          if (row.property_id) map.set(row.property_id, row)
        }
      }
      return map
    },
  })
}

/** The owner row itself — outcome tags + pipeline status for the card header. */
export function useOwnerRecord(ownerId: string | null | undefined) {
  return useQuery({
    queryKey: ['owner-record', ownerId],
    enabled: !!ownerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('owners')
        .select('id, tags, verification_status')
        .eq('id', ownerId!)
        .single()
      if (error) throw error
      return data
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


function invalidateOwnerViews(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['owner-contacts'] })
  qc.invalidateQueries({ queryKey: ['owner-context'] })
  qc.invalidateQueries({ queryKey: ['owner-conversations'] })
}

/**
 * Add a VERIFIED contact to a property's owner from the property page. Reuses the same DB
 * routine as the GHL webhook: upserts the contact by phone, mints the owner entity when the
 * parcel has none, links confirmed, keeps owners.verification_status in lockstep.
 */
export function useAddVerifiedContact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: {
      property: Pick<Tables<'properties'>, 'parcel_number' | 'address' | 'city' | 'owner_name'>
      first: string
      last?: string | null
      phone: string
      email?: string | null
    }) => {
      const { data, error } = await supabase.rpc('ghl_verify_owner', {
        p: {
          status: 'verified',
          parcel: v.property.parcel_number,
          address: v.property.address,
          city: v.property.city,
          owner_name: v.property.owner_name,
          first: v.first,
          last: v.last ?? null,
          phone: v.phone,
          email: v.email ?? null,
          role: 'owner',
        },
      })
      if (error) throw error
      const res = data as { ok?: boolean; error?: string } | null
      if (!res?.ok) throw new Error(res?.error ?? 'could not verify contact')
    },
    onSuccess: () => invalidateOwnerViews(qc),
  })
}

/**
 * Unlink a contact from an owner (the contact itself and its history survive). If that was
 * the owner's last confirmed link, the owner drops back to unverified so the map stays honest.
 */
export function useRemoveOwnerContact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { linkId: string; ownerId: string }) => {
      const { error } = await supabase.from('owner_contacts').delete().eq('id', v.linkId)
      if (error) throw error
      const { count, error: e2 } = await supabase
        .from('owner_contacts')
        .select('id', { count: 'exact', head: true })
        .eq('owner_id', v.ownerId)
        .eq('confidence', 'confirmed')
      if (e2) throw e2
      if ((count ?? 0) === 0) {
        await supabase
          .from('owners')
          .update({ verification_status: 'unverified', verification_updated_at: new Date().toISOString() })
          .eq('id', v.ownerId)
      }
    },
    onSuccess: () => invalidateOwnerViews(qc),
  })
}
