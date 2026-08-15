import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { fetchPages } from '@/lib/paged-fetch'
import type { Tables } from '@/lib/database.types'

export type OwnerContext = Tables<'v_property_owner_context'>
/** The owning entity is a companies row now (owners/owner_contacts are retired). */
export type OwnerCompany = Pick<
  Tables<'companies'>,
  'id' | 'name' | 'entity_kind' | 'mailing_address' | 'tags' | 'exported_at'
>
export type Communication = Tables<'communications'>

/**
 * Per-property owner context, keyed by property id.
 *
 * One row per property (the view already rolls up portfolio size, contact counts and
 * last-conversation recency), so the list can filter on "do we have a verified owner
 * contact" without a second round trip per pin.
 *
 * Costly enough to be opt-in: the view runs five lateral joins per row, so the whole
 * book is tens of seconds of database work. `enabled` lets a caller that only needs the
 * properties on screen skip it — the map gets its owner context from `map_properties()`
 * instead, already scoped to the viewport.
 */
export function useOwnerContext(enabled = true) {
  return useQuery({
    queryKey: ['owner-context'],
    enabled,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      // ~13k rows behind PostgREST's 1000-row cap — fetch the pages in parallel; serial
      // paging plus a zero staleTime is what made back-navigation to the map crawl.
      const PAGE = 1000
      // count:'exact' only on the first request — the later parallel pages don't need the
      // total, and re-counting a ~13k-row view per page multiplies server work.
      const base = (withCount?: boolean) =>
        supabase
          .from('v_property_owner_context')
          .select('*', withCount ? { count: 'exact' } : undefined)
          .order('property_id')
      const first = await base(true).range(0, PAGE - 1)
      if (first.error) throw first.error
      const total = first.count ?? (first.data?.length ?? 0)
      // Pooled + per-page retry, same as useProperties: this view is ~1ms/row of
      // database work, and 30+ simultaneous pages is what was producing the 500s.
      const rest = await fetchPages(
        Math.max(0, Math.ceil(total / PAGE) - 1),
        async (i) => {
          const r = await base().range((i + 1) * PAGE, (i + 2) * PAGE - 1)
          if (r.error) throw r.error
          return (r.data ?? []) as OwnerContext[]
        },
      )
      const map = new Map<string, OwnerContext>()
      for (const rows of [(first.data ?? []) as OwnerContext[], ...rest]) {
        for (const row of rows) {
          if (row.property_id) map.set(row.property_id, row)
        }
      }
      return map
    },
  })
}

/** The owning company itself — outcome tags + export stamp for the card header. */
export function useOwnerRecord(ownerCompanyId: string | null | undefined) {
  return useQuery({
    queryKey: ['owner-record', ownerCompanyId],
    enabled: !!ownerCompanyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('companies')
        .select('id, name, entity_kind, mailing_address, tags, exported_at')
        .eq('id', ownerCompanyId!)
        .single()
      if (error) throw error
      return data as OwnerCompany
    },
  })
}

/** Every property an owning company holds — the portfolio view behind a map pin. */
export function useOwnerProperties(ownerCompanyId: string | null | undefined) {
  return useQuery({
    queryKey: ['owner-properties', ownerCompanyId],
    enabled: !!ownerCompanyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('properties')
        .select('id, address, city, county, property_type, gross_sf, land_acres, listing_status, lat, lng')
        .eq('owner_company_id', ownerCompanyId!)
        .order('address')
      if (error) throw error
      return data ?? []
    },
  })
}

/**
 * Contact ids we've actually verified — a human confirmed this person on this number
 * (`contacts.verified_at`, the one surviving verification mark now that the
 * owner_contacts confidence ladder is retired).
 *
 * Returned as a Set so list rows are an O(1) lookup rather than a scan per row.
 * Paged: ~1,100 verified people sit just past PostgREST's silent 1000-row cap.
 */
export function useVerifiedContactIds() {
  return useQuery({
    queryKey: ['verified-contact-ids'],
    queryFn: async () => {
      const PAGE = 1000
      const base = (withCount?: boolean) =>
        supabase
          .from('contacts')
          .select('id', withCount ? { count: 'exact' } : undefined)
          .not('verified_at', 'is', null)
          .order('id')
      const first = await base(true).range(0, PAGE - 1)
      if (first.error) throw first.error
      const total = first.count ?? (first.data?.length ?? 0)
      const rest = await Promise.all(
        Array.from({ length: Math.max(0, Math.ceil(total / PAGE) - 1) }, (_, i) =>
          base().range((i + 1) * PAGE, (i + 2) * PAGE - 1),
        ),
      )
      const ids = new Set<string>()
      for (const r of [first, ...rest]) {
        if (r.error) throw r.error
        for (const row of r.data ?? []) ids.add(row.id as string)
      }
      return ids
    },
  })
}

/** A person seated at an owning company — the flat contacts row, no link table between. */
export type OwnerPersonRow = Pick<
  Tables<'contacts'>,
  | 'id'
  | 'first_name'
  | 'last_name'
  | 'phone'
  | 'email'
  | 'title'
  | 'do_not_call'
  | 'campaign_lists'
  | 'email_verified_at'
  | 'verified_at'
  | 'verified_by'
  | 'company_id'
>

/** The humans seated at an owning company, verified first. */
export function useOwnerContacts(ownerCompanyId: string | null | undefined) {
  return useQuery({
    queryKey: ['owner-contacts', ownerCompanyId],
    enabled: !!ownerCompanyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contacts')
        .select(
          'id, first_name, last_name, phone, email, title, do_not_call, campaign_lists, email_verified_at, verified_at, verified_by, company_id',
        )
        .eq('company_id', ownerCompanyId!)
      if (error) throw error
      const rows = (data ?? []) as OwnerPersonRow[]
      // verified people first, then whoever is most reachable
      return rows.sort(
        (a, b) =>
          Number(!!b.verified_at) - Number(!!a.verified_at) ||
          Number(!!b.email_verified_at) - Number(!!a.email_verified_at) ||
          Number(!!b.phone) - Number(!!a.phone),
      )
    },
  })
}

/**
 * Conversation history for an owning company: everything logged against the company
 * itself, plus anything logged against the humans seated at it. Newest first.
 */
export function useOwnerConversations(ownerCompanyId: string | null | undefined, contactIds: string[]) {
  const key = [...contactIds].sort().join(',')
  return useQuery({
    queryKey: ['owner-conversations', ownerCompanyId, key],
    enabled: !!ownerCompanyId,
    queryFn: async () => {
      const clauses = [`owner_company_id.eq.${ownerCompanyId}`]
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
 * routine as the GHL webhook: upserts the contact by phone, stamps contacts.verified_at,
 * and seats the person at the owning company.
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
 * Unseat a person from an owning company (the contact itself and its history survive —
 * only the company link is cleared). The view derives owner verification from the seated
 * contacts, so the map goes honest on its own; there is no status column to sync anymore.
 */
export function useRemoveOwnerContact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { contactId: string; ownerCompanyId: string }) => {
      const { error } = await supabase
        .from('contacts')
        .update({ company_id: null })
        .eq('id', v.contactId)
        .eq('company_id', v.ownerCompanyId)
      if (error) throw error
    },
    onSuccess: () => invalidateOwnerViews(qc),
  })
}


/**
 * Mark a person verified or not. Verified means "someone had a conversation on this
 * line" — `contacts.verified_at` is the one surviving mark (the owner_contacts
 * confidence ladder is retired). The owner's map status follows its seated contacts
 * through the view; nothing else to sync.
 */
export function useSetPhoneVerified() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { contactId: string; verified: boolean }) => {
      const { error } = await supabase
        .from('contacts')
        .update(
          v.verified
            ? { verified_at: new Date().toISOString(), verified_by: 'Alex (manual)' }
            : { verified_at: null, verified_by: null },
        )
        .eq('id', v.contactId)
      if (error) throw error
    },
    onSuccess: () => invalidateOwnerViews(qc),
  })
}

/** Mark an email verified or not — the address is proven to reach a human. */
export function useSetEmailVerified() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { contactId: string; verified: boolean }) => {
      const { error } = await supabase
        .from('contacts')
        .update({ email_verified_at: v.verified ? new Date().toISOString() : null })
        .eq('id', v.contactId)
      if (error) throw error
    },
    onSuccess: () => invalidateOwnerViews(qc),
  })
}

/** Replace the owning company's outcome tags (the card's chip editor writes the whole array). */
export function useUpdateOwnerTags() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { ownerCompanyId: string; tags: string[] }) => {
      const { error } = await supabase
        .from('companies')
        .update({ tags: v.tags.length ? v.tags : null })
        .eq('id', v.ownerCompanyId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['owner-record'] })
      qc.invalidateQueries({ queryKey: ['owner-context'] })
    },
  })
}
