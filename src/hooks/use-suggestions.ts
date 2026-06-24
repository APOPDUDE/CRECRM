import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export type SearchingClient = {
  id: string
  company: { name: string } | null
  contact: { first_name: string; last_name: string | null } | null
}

/** Display name for a client (company first, else contact, else fallback). */
export function clientLabel(c: {
  company?: { name: string } | null
  contact?: { first_name: string; last_name: string | null } | null
} | null): string {
  if (c?.company?.name) return c.company.name
  if (c?.contact) {
    const n = [c.contact.first_name, c.contact.last_name].filter(Boolean).join(' ')
    if (n) return n
  }
  return 'Unnamed client'
}

/** All clients still in the searching pool — the choices for "add suggestion to". */
export function useSearchingClients() {
  return useQuery({
    queryKey: ['clients', 'searching'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select(
          'id, company:companies!clients_company_id_fkey(name), contact:contacts!clients_contact_id_fkey(first_name, last_name)',
        )
        .eq('status', 'searching')
      if (error) throw error
      const rows = data as unknown as SearchingClient[]
      return [...rows].sort((a, b) => clientLabel(a).localeCompare(clientLabel(b)))
    },
  })
}
