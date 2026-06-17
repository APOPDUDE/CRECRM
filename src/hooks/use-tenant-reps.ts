import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Enums, Tables, TablesInsert, TablesUpdate } from '@/lib/database.types'

/** A client (tenant/buyer) with the relations the overview board + cards need. */
export type TenantRepWithRelations = Tables<'clients'> & {
  company: Pick<Tables<'companies'>, 'id' | 'name'> | null
  contact: Pick<Tables<'contacts'>, 'id' | 'first_name' | 'last_name'> | null
  broker: Pick<Tables<'contacts'>, 'id' | 'first_name' | 'last_name'> | null
  pursuits: { id: string; stage: Enums<'pursuit_stage'> }[]
  /** alias of pursuits for existing call sites */
  matches: { id: string; stage: Enums<'pursuit_stage'> }[]
}

const TENANT_REP_SELECT = `
  *,
  company:companies!clients_company_id_fkey(id, name),
  contact:contacts!clients_contact_id_fkey(id, first_name, last_name),
  broker:contacts!clients_broker_contact_id_fkey(id, first_name, last_name),
  pursuits(id, stage)
`

type ClientRow = Tables<'clients'> & {
  company: TenantRepWithRelations['company']
  contact: TenantRepWithRelations['contact']
  broker: TenantRepWithRelations['broker']
  pursuits: { id: string; stage: Enums<'pursuit_stage'> }[]
}

function decorate(row: ClientRow): TenantRepWithRelations {
  return { ...row, matches: row.pursuits ?? [] }
}

export function useTenantReps() {
  return useQuery({
    queryKey: ['tenant_reps'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select(TENANT_REP_SELECT)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data as unknown as ClientRow[]).map(decorate)
    },
  })
}

const TENANT_REP_DETAIL_SELECT = `
  *,
  company:companies!clients_company_id_fkey(id, name, type, phone, website, industry, notes),
  contact:contacts!clients_contact_id_fkey(id, first_name, last_name, title, email, phone, company_id, notes),
  broker:contacts!clients_broker_contact_id_fkey(id, first_name, last_name)
`

export type TenantRepDetail = Tables<'clients'> & {
  company: Pick<
    Tables<'companies'>,
    'id' | 'name' | 'type' | 'phone' | 'website' | 'industry' | 'notes'
  > | null
  contact: Pick<
    Tables<'contacts'>,
    'id' | 'first_name' | 'last_name' | 'title' | 'email' | 'phone' | 'company_id' | 'notes'
  > | null
  broker: Pick<Tables<'contacts'>, 'id' | 'first_name' | 'last_name'> | null
}

/** Single client with full relations for the tenant-board sidebar. */
export function useTenantRepDetail(id: string | undefined) {
  return useQuery({
    queryKey: ['tenant_rep', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
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
    mutationFn: async (values: TablesInsert<'clients'>) => {
      const { data, error } = await supabase.from('clients').insert(values).select().single()
      if (error) throw error
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tenant_reps'] }),
  })
}

export function useUpdateTenantRep() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...values }: TablesUpdate<'clients'> & { id: string }) => {
      const { data, error } = await supabase
        .from('clients')
        .update(values)
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['tenant_reps'] })
      if (data?.id) queryClient.invalidateQueries({ queryKey: ['tenant_rep', data.id] })
    },
  })
}

/** Mark a client lost, optionally marking its open pursuits passed. */
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
        .from('clients')
        .update({ status: 'lost', lost_reason: lostReason })
        .eq('id', id)
      if (error) throw error
      if (markMatchesDead) {
        const { error: pErr } = await supabase
          .from('pursuits')
          .update({ stage: 'passed' })
          .eq('client_id', id)
          .neq('stage', 'passed')
        if (pErr) throw pErr
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
        .from('clients')
        .update({ status: 'searching', lost_reason: null })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tenant_reps'] }),
  })
}

/** Move a client to a new lifecycle status (the tenant overview board drag). */
export function useUpdateClientStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: Enums<'client_status'> }) => {
      const { error } = await supabase.from('clients').update({ status }).eq('id', id)
      if (error) throw error
    },
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: ['tenant_reps'] })
      const previous = queryClient.getQueryData<TenantRepWithRelations[]>(['tenant_reps'])
      queryClient.setQueryData<TenantRepWithRelations[]>(['tenant_reps'], (old) =>
        old?.map((t) => (t.id === id ? { ...t, status } : t)),
      )
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(['tenant_reps'], context.previous)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['tenant_reps'] }),
  })
}
