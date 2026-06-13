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

const TENANT_REP_DETAIL_SELECT = `
  *,
  company:companies!tenant_reps_tenant_company_id_fkey(id, name, phone),
  contact:contacts!tenant_reps_tenant_contact_id_fkey(id, first_name, last_name, title, email, phone),
  broker:contacts!tenant_reps_broker_contact_id_fkey(id, first_name, last_name)
`

export type TenantRepDetail = Tables<'tenant_reps'> & {
  company: Pick<Tables<'companies'>, 'id' | 'name' | 'phone'> | null
  contact: Pick<
    Tables<'contacts'>,
    'id' | 'first_name' | 'last_name' | 'title' | 'email' | 'phone'
  > | null
  broker: Pick<Tables<'contacts'>, 'id' | 'first_name' | 'last_name'> | null
}

/** Single tenant rep with full relations for the tenant-board sidebar. */
export function useTenantRepDetail(id: string | undefined) {
  return useQuery({
    queryKey: ['tenant_rep', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tenant_reps')
        .select(TENANT_REP_DETAIL_SELECT)
        .eq('id', id!)
        .single()
      if (error) throw error
      return data as unknown as TenantRepDetail
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

/** Mark a tenant rep lost, optionally killing its open property matches too. */
export function useMarkTenantRepLost() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      lostReason,
      markMatchesDead,
    }: {
      id: string
      lostReason: string | null
      markMatchesDead: boolean
    }) => {
      const { error } = await supabase
        .from('tenant_reps')
        .update({ status: 'lost', lost_reason: lostReason })
        .eq('id', id)
      if (error) throw error
      if (markMatchesDead) {
        const { error: matchError } = await supabase
          .from('matches')
          .update({ stage: 'dead' })
          .eq('tenant_rep_id', id)
          .neq('stage', 'dead')
        if (matchError) throw matchError
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant_reps'] })
      queryClient.invalidateQueries({ queryKey: ['matches'] })
    },
  })
}

export function useReopenTenantRep() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('tenant_reps')
        .update({ status: 'active', lost_reason: null })
        .eq('id', id)
      if (error) throw error
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
    onMutate: async ({ id, stage }) => {
      await queryClient.cancelQueries({ queryKey: ['tenant_reps'] })
      const previous = queryClient.getQueryData<TenantRepWithRelations[]>(['tenant_reps'])
      queryClient.setQueryData<TenantRepWithRelations[]>(['tenant_reps'], (old) =>
        old?.map((t) => (t.id === id ? { ...t, stage } : t)),
      )
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(['tenant_reps'], context.previous)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['tenant_reps'] }),
  })
}
