import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Tables, TablesInsert, TablesUpdate } from '@/lib/database.types'

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
