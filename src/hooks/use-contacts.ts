import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Tables, TablesInsert, TablesUpdate } from '@/lib/database.types'
import { formatPhone, normalizePhone } from '@/lib/format'

export type Contact = Tables<'contacts'> & {
  company: Pick<Tables<'companies'>, 'id' | 'name'> | null
}

const CONTACT_SELECT = '*, company:companies(id, name)'

/** Shortest query worth sending — one letter would just return the row cap. */
export const CONTACT_SEARCH_MIN = 2

/** Display name for a contact: "First Last", or "First" when no last name. */
export function contactNameOf(contact: {
  first_name: string
  last_name: string | null
}): string {
  return [contact.first_name, contact.last_name].filter(Boolean).join(' ')
}

export type ContactSort = 'created' | 'activity' | 'alpha'

const SORT_COLUMN: Record<ContactSort, { column: string; ascending: boolean }> = {
  created: { column: 'created_at', ascending: false },
  activity: { column: 'updated_at', ascending: false },
  alpha: { column: 'first_name', ascending: true },
}

/**
 * A page of the live contact book, for browsing. Archived rows are import padding with no
 * relationship evidence (see migration 20260810000001) — they stay in the table because comps,
 * owner guesses and campaign history still point at them, but they never surface here.
 *
 * This is deliberately a LIMITED page and reports the true total alongside it. The book is
 * ~5k live contacts and PostgREST caps a response at 1000 rows, so "just fetch them all and
 * filter in the browser" silently became "fetch the first 1000 names alphabetically" — which
 * is why nobody past "Dan" could be found. Finding a specific person is useContactSearch's
 * job, and that runs over the whole table in Postgres.
 */
export function useContactBook(sort: ContactSort, limit = 100) {
  return useQuery({
    queryKey: ['contacts', 'book', { sort, limit }],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { column, ascending } = SORT_COLUMN[sort] ?? SORT_COLUMN.created
      const { data, error, count } = await supabase
        .from('contacts')
        .select(CONTACT_SELECT, { count: 'exact' })
        .eq('archived', false)
        .order(column, { ascending })
        .limit(limit)
      if (error) throw error
      return { rows: (data ?? []) as Contact[], total: count ?? 0 }
    },
  })
}

/**
 * Search the whole book — every contact, archived included, matched on name, phone digits,
 * email, title or company by search_contacts() in Postgres.
 *
 * The RPC ranks the hits; this refetches those ids as full contact rows so callers get real
 * Contact objects (an edit form needs every column, not the handful the RPC returns) and then
 * puts them back in the RPC's order.
 */
export function useContactSearch(
  query: string,
  opts: { limit?: number; includeArchived?: boolean } = {},
) {
  const q = query.trim()
  const limit = opts.limit ?? 50
  const includeArchived = opts.includeArchived ?? true
  return useQuery({
    queryKey: ['contacts', 'search', { q, limit, includeArchived }],
    enabled: q.length >= CONTACT_SEARCH_MIN,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('search_contacts', {
        p_query: q,
        p_limit: limit,
        p_include_archived: includeArchived,
      })
      if (error) throw error
      const ids = (data ?? []).map((row) => row.id)
      if (ids.length === 0) return []
      const full = await supabase.from('contacts').select(CONTACT_SELECT).in('id', ids)
      if (full.error) throw full.error
      const byId = new Map((full.data as Contact[]).map((c) => [c.id, c]))
      return ids.map((id) => byId.get(id)).filter(Boolean) as Contact[]
    },
  })
}

/**
 * The contact who already owns this phone number, if any. Uses the same exact match on the
 * canonical format that useUpsertContactByPhone does, so what the form warns about and what
 * saving actually does can never disagree.
 */
export function useContactByPhone(phone: string | null | undefined) {
  const canonical = formatPhone(phone)
  return useQuery({
    queryKey: ['contacts', 'by-phone', canonical],
    enabled: !!canonical,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contacts')
        .select(CONTACT_SELECT)
        .eq('phone', canonical!)
        .maybeSingle()
      if (error) throw error
      return (data as Contact | null) ?? null
    },
  })
}

export function useContact(id: string | undefined) {
  return useQuery({
    queryKey: ['contacts', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contacts')
        .select(CONTACT_SELECT)
        .eq('id', id!)
        .single()
      if (error) throw error
      return data as Contact
    },
  })
}

export function useCreateContact() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (values: TablesInsert<'contacts'>) => {
      const { data, error } = await supabase.from('contacts').insert(values).select().single()
      if (error) throw error
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['contacts'] }),
  })
}

/**
 * Upsert a contact keyed by its (normalized) phone — the contact's true identity.
 * If a contact with the same number already exists it is updated with the given
 * values; otherwise a new one is inserted. Phone is the dedupe key so re-entering
 * a known number never creates a duplicate.
 */
export function useUpsertContactByPhone() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (values: TablesInsert<'contacts'>) => {
      // The DB trigger canonicalizes stored phones, so an exact match on the
      // formatted number finds the existing row.
      const canonical = formatPhone(values.phone)
      if (normalizePhone(values.phone) && canonical) {
        const { data: existing, error: findErr } = await supabase
          .from('contacts')
          .select('id')
          .eq('phone', canonical)
          .maybeSingle()
        if (findErr) throw findErr
        if (existing) {
          const { data, error } = await supabase
            .from('contacts')
            .update(values)
            .eq('id', existing.id)
            .select()
            .single()
          if (error) throw error
          return data
        }
      }
      const { data, error } = await supabase.from('contacts').insert(values).select().single()
      if (error) throw error
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['contacts'] }),
  })
}

export function useUpdateContact() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...values }: TablesUpdate<'contacts'> & { id: string }) => {
      const { data, error } = await supabase.from('contacts').update(values).eq('id', id).select().single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] })
      // company page roster + the lease map's decision-maker fields both read contact
      // rows — a DM change must reach them without a reload
      queryClient.invalidateQueries({ queryKey: ['company-contacts'] })
      queryClient.invalidateQueries({ queryKey: ['lease-comps'] })
      // the contact name shows as tenant/landlord/broker contact across many joined
      // queries — refresh those so a rename shows immediately everywhere it appears
      queryClient.invalidateQueries({ queryKey: ['tenant_reps'] })
      queryClient.invalidateQueries({ queryKey: ['tenant_rep'] })
      queryClient.invalidateQueries({ queryKey: ['listings'] })
      queryClient.invalidateQueries({ queryKey: ['listing'] })
      queryClient.invalidateQueries({ queryKey: ['matches'] })
      queryClient.invalidateQueries({ queryKey: ['match'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-matches'] })
      queryClient.invalidateQueries({ queryKey: ['property-deals'] })
    },
  })
}

export function useDeleteContact() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('contacts').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['contacts'] }),
  })
}

export type ContactProperty = {
  id: string
  address: string
  city: string | null
  gross_sf: number | null
  land_acres: number | null
  listing_status: string | null
  /** how this contact reaches the property: as its owner, or via a deal on it */
  via: 'owner' | 'listing'
}

export type ContactDeal = {
  kind: 'listing' | 'client' | 'prospect'
  id: string
  /** where clicking it goes */
  href: string
  title: string
  subtitle: string | null
  status: string | null
}

/**
 * Everything a contact is attached to: the properties they own or are the landlord
 * contact on, and the deals they appear in.
 *
 * A contact reaches a property two different ways and both matter — they can be seated at
 * the owning company (contacts.company_id -> properties.owner_company_id) or the named
 * landlord contact on a listing. The same property can arrive by both routes, so it is
 * deduped with the owner relationship winning, that being the stronger claim.
 */
export function useContactAssociations(contactId: string | undefined) {
  return useQuery({
    queryKey: ['contact-associations', contactId],
    enabled: !!contactId,
    queryFn: async () => {
      const PROP_COLS = 'id, address, city, gross_sf, land_acres, listing_status'

      // The seat first: which company does this human belong to (owners are retired —
      // a confirmed owner-person simply hangs off the owning-entity company).
      const seat = await supabase
        .from('contacts')
        .select('company_id')
        .eq('id', contactId!)
        .single()
      if (seat.error) throw seat.error
      const companyId = seat.data?.company_id ?? null

      const [ownedRes, listingsRes, clientsRes, prospectsRes] = await Promise.all([
        companyId
          ? supabase.from('properties').select(PROP_COLS).eq('owner_company_id', companyId).order('address')
          : Promise.resolve({ data: [], error: null } as const),
        supabase
          .from('listings')
          .select(`id, deal_type, stage, status, property:properties!listings_property_id_fkey(${PROP_COLS})`)
          .or(`landlord_contact_id.eq.${contactId},broker_contact_id.eq.${contactId}`)
          .order('created_at', { ascending: false }),
        supabase
          .from('clients')
          .select('id, status, deal_type, purpose, company:companies!clients_company_id_fkey(id, name)')
          .or(`contact_id.eq.${contactId},broker_contact_id.eq.${contactId}`)
          .order('created_at', { ascending: false }),
        supabase
          .from('prospects')
          .select('id, description, status, lead_type')
          .eq('contact_id', contactId!)
          .order('created_at', { ascending: false }),
      ])
      if (ownedRes.error) throw ownedRes.error
      if (listingsRes.error) throw listingsRes.error
      if (clientsRes.error) throw clientsRes.error
      if (prospectsRes.error) throw prospectsRes.error

      const byId = new Map<string, ContactProperty>()
      for (const p of (ownedRes.data ?? []) as ContactProperty[]) {
        byId.set(p.id, { ...p, via: 'owner' })
      }
      type ListingRow = {
        id: string
        deal_type: string | null
        stage: string | null
        status: string | null
        property: ContactProperty | null
      }
      const listings = (listingsRes.data ?? []) as unknown as ListingRow[]
      for (const l of listings) {
        // Owner beats listing-contact: don't downgrade a property we already know they own.
        if (l.property && !byId.has(l.property.id)) {
          byId.set(l.property.id, { ...l.property, via: 'listing' })
        }
      }

      const deals: ContactDeal[] = [
        ...listings.map((l) => ({
          kind: 'listing' as const,
          id: l.id,
          href: `/landlord-rep/${l.id}`,
          title: l.property?.address ?? 'Listing',
          subtitle: l.deal_type === 'sale' ? 'For sale' : l.deal_type === 'both' ? 'For lease or sale' : 'For lease',
          status: l.status === 'lost' ? 'Lost' : l.stage,
        })),
        ...((clientsRes.data ?? []) as unknown as {
          id: string; status: string | null; deal_type: string | null; purpose: string | null
          company: { id: string; name: string } | null
        }[]).map((c) => ({
          kind: 'client' as const,
          id: c.id,
          href: `/tenant-rep/${c.id}`,
          title: c.company?.name ?? 'Client',
          subtitle: [c.purpose, c.deal_type].filter(Boolean).join(' · ') || null,
          status: c.status,
        })),
        ...((prospectsRes.data ?? []) as unknown as {
          id: string; description: string | null; status: string | null; lead_type: string | null
        }[]).map((p) => ({
          kind: 'prospect' as const,
          id: p.id,
          href: '/prospecting',
          title: p.description || 'Prospect',
          subtitle: p.lead_type,
          status: p.status,
        })),
      ]

      return { properties: [...byId.values()], deals }
    },
  })
}
