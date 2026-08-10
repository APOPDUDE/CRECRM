import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Tables, TablesInsert, TablesUpdate } from '@/lib/database.types'

export type Company = Tables<'companies'>

export function useCompanies() {
  return useQuery({
    queryKey: ['companies'],
    queryFn: async () => {
      const { data, error } = await supabase.from('companies').select('*').order('name')
      if (error) throw error
      return data
    },
  })
}

export function useCompany(id: string | undefined) {
  return useQuery({
    queryKey: ['companies', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('companies').select('*').eq('id', id!).single()
      if (error) throw error
      return data
    },
  })
}

export function useCreateCompany() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (values: TablesInsert<'companies'>) => {
      const { data, error } = await supabase.from('companies').insert(values).select().single()
      if (error) throw error
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['companies'] }),
  })
}

export function useUpdateCompany() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...values }: TablesUpdate<'companies'> & { id: string }) => {
      const { data, error } = await supabase.from('companies').update(values).eq('id', id).select().single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] })
      // the company name is embedded in many joined queries — refresh those too so a
      // rename shows immediately on open boards, the dashboard, and property detail
      queryClient.invalidateQueries({ queryKey: ['contacts'] })
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

export function useDeleteCompany() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('companies').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] })
      queryClient.invalidateQueries({ queryKey: ['contacts'] })
    },
  })
}

/**
 * The people at a company, decision makers first.
 *
 * Ordering is the point: when a lease is expiring, the question is "who makes the
 * call", so verified decision makers sort to the top, suspected next, everyone else
 * after, alphabetical within each band.
 */
export function useCompanyContacts(companyId: string | undefined) {
  return useQuery({
    queryKey: ['company-contacts', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contacts')
        .select('id, first_name, last_name, title, email, phone, decision_maker')
        .eq('company_id', companyId!)
        .not('archived', 'is', true)
        .order('first_name')
      if (error) throw error
      const rank = { verified: 0, suspected: 1, none: 2 } as const
      return [...data].sort((a, b) => rank[a.decision_maker] - rank[b.decision_maker])
    },
  })
}

export type CompanyLease = {
  id: string
  property_id: string
  sf: number | null
  executed_lease_rate_psf: number | null
  lease_structure: string | null
  commencement_date: string | null
  expiration_date: string | null
  property: { address: string; city: string | null; state: string | null } | null
}

/**
 * Everywhere this tenant holds (or held) space — their footprint across the book.
 * Soonest expiry first, because that is the lease you can still do something about.
 */
export function useCompanyLeases(companyId: string | undefined) {
  return useQuery({
    queryKey: ['company-leases', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('comps')
        .select(
          'id, property_id, sf, executed_lease_rate_psf, lease_structure, ' +
            'commencement_date, expiration_date, ' +
            'property:properties!comps_property_id_fkey(address, city, state)',
        )
        .eq('tenant_company_id', companyId!)
        .eq('deal_type', 'lease')
        .eq('kind', 'executed')
        .order('expiration_date', { ascending: true, nullsFirst: false })
      if (error) throw error
      return data as unknown as CompanyLease[]
    },
  })
}
