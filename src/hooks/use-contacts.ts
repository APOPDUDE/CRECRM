import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Tables, TablesInsert, TablesUpdate } from '@/lib/database.types'
import { formatPhone, normalizePhone } from '@/lib/format'

export type Contact = Tables<'contacts'> & {
  company: Pick<Tables<'companies'>, 'id' | 'name'> | null
}

const CONTACT_SELECT = '*, company:companies(id, name)'

/** Display name for a contact: "First Last", or "First" when no last name. */
export function contactNameOf(contact: {
  first_name: string
  last_name: string | null
}): string {
  return [contact.first_name, contact.last_name].filter(Boolean).join(' ')
}

/** Find a cached contact whose phone normalizes to the same 10 digits (~46 rows). */
export function findContactByPhone<T extends { phone: string | null }>(
  contacts: T[],
  phone: string | null | undefined,
): T | undefined {
  const n = normalizePhone(phone)
  if (!n) return undefined
  return contacts.find((c) => normalizePhone(c.phone) === n)
}

export function useContacts() {
  return useQuery({
    queryKey: ['contacts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contacts')
        .select(CONTACT_SELECT)
        .order('first_name')
      if (error) throw error
      return data as Contact[]
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['contacts'] }),
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
