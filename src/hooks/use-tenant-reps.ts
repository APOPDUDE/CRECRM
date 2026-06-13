import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Enums, Tables, TablesInsert, TablesUpdate } from '@/lib/database.types'

const TENANT_REP_SELECT = `
  *,
  company:companies!tenant_reps_tenant_company_id_fkey(id, name),
  contact:contacts!tenant_reps_tenant_contact_id_fkey(id, first_name, last_name),
  broker:contacts!tenant_reps_broker_contact_id_fkey(id, first_name, last_name),
  matches(id, stage)
`

export type TenantRepWithRelations = Tables<'tenant_reps'> & {
  company: Pick<Tables<'companies'>, 'id' | 'name'> | null
  contact: Pick<Tables<'contacts'>, 'id' | 'first_name' | 'last_name'> | null
  broker: Pick<Tables<'contacts'>, 'id' | 'first_name' | 'last_name'> | null
  matches: { id: string; stage: Enums<'match_stage'> }[]
}

export function useTenantReps() {
  return useQuery({
    queryKey: ['tenant_reps'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tenant_reps')
        .select(TENANT_REP_SELECT)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as unknown as TenantRepWithRelations[]
    },
  })
}

export function useCreateTenantRep() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (values: TablesInsert<'tenant_reps'>) => {
      const { data, error } = await supabase.from('tenant_reps').insert(values).select().single()
      if (error) throw error
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tenant_reps'] }),
  })
}

export function useUpdateTenantRep() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...values }: TablesUpdate<'tenant_reps'> & { id: string }) => {
      const { data, error } = await supabase
        .from('tenant_reps')
        .update(values)
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tenant_reps'] }),
  })
}

export function useUpdateTenantRepStage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, stage }: { id: string; stage: Enums<'tenant_rep_stage'> }) => {
      const { error } = await supabase.from('tenant_reps').update({ stage }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tenant_reps'] }),
  })
}
