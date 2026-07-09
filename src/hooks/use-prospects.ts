import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Enums, Tables, TablesUpdate } from '@/lib/database.types'

/** A pre-pipeline lead: contact/company + attached properties + description + tasks. */
export type ProspectWithRelations = Tables<'prospects'> & {
  contact: Pick<Tables<'contacts'>, 'id' | 'first_name' | 'last_name' | 'phone' | 'email'> | null
  company: Pick<Tables<'companies'>, 'id' | 'name'> | null
  properties: {
    property_id: string
    property: Pick<Tables<'properties'>, 'id' | 'address' | 'city' | 'state'> | null
  }[]
}

const PROSPECT_SELECT = `
  *,
  contact:contacts!prospects_contact_id_fkey(id, first_name, last_name, phone, email),
  company:companies!prospects_company_id_fkey(id, name),
  properties:prospect_properties(property_id, property:properties!prospect_properties_property_id_fkey(id, address, city, state))
`

export function useProspects(includeClosed = false) {
  return useQuery({
    queryKey: ['prospects', includeClosed],
    queryFn: async (): Promise<ProspectWithRelations[]> => {
      let q = supabase
        .from('prospects')
        .select(PROSPECT_SELECT)
        .order('created_at', { ascending: false })
      if (!includeClosed) q = q.eq('status', 'open')
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as unknown as ProspectWithRelations[]
    },
  })
}

export function useCreateProspect() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (values: {
      owner_id: string
      contact_id: string
      company_id?: string | null
      description?: string | null
      property_ids: string[]
    }) => {
      const { property_ids, ...row } = values
      const { data, error } = await supabase.from('prospects').insert(row).select().single()
      if (error) throw error
      if (property_ids.length > 0) {
        const { error: joinErr } = await supabase
          .from('prospect_properties')
          .insert(property_ids.map((property_id) => ({ prospect_id: data.id, property_id })))
        if (joinErr) throw joinErr
      }
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['prospects'] }),
  })
}

export function useUpdateProspect() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...values }: TablesUpdate<'prospects'> & { id: string }) => {
      const { error } = await supabase.from('prospects').update(values).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['prospects'] }),
  })
}

export function useAddProspectProperty() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ prospectId, propertyId }: { prospectId: string; propertyId: string }) => {
      const { error } = await supabase
        .from('prospect_properties')
        .upsert({ prospect_id: prospectId, property_id: propertyId })
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['prospects'] }),
  })
}

export function useRemoveProspectProperty() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ prospectId, propertyId }: { prospectId: string; propertyId: string }) => {
      const { error } = await supabase
        .from('prospect_properties')
        .delete()
        .eq('prospect_id', prospectId)
        .eq('property_id', propertyId)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['prospects'] }),
  })
}

export type ConvertResult = {
  target: 'listing' | 'client'
  client_id: string | null
  listing_ids: string[]
  pursuit_ids: string[]
}

/**
 * Push a prospect into a pipeline (the convert_prospect RPC): 'listing' creates one
 * proposal listing per attached property with the contact as landlord; 'client' creates
 * a searching tenant-rep client plus one inquiring pursuit per property. Open prospect
 * tasks follow the deal.
 */
export function useConvertProspect() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      prospectId: string
      target: 'listing' | 'client'
      dealType: Enums<'deal_type'>
    }): Promise<ConvertResult> => {
      const { data, error } = await supabase.rpc('convert_prospect', {
        p_prospect_id: args.prospectId,
        p_target: args.target,
        p_deal_type: args.dealType,
      })
      if (error) throw error
      return data as unknown as ConvertResult
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prospects'] })
      queryClient.invalidateQueries({ queryKey: ['listings'] })
      queryClient.invalidateQueries({ queryKey: ['tenant_reps'] })
      queryClient.invalidateQueries({ queryKey: ['matches'] })
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
    },
  })
}
