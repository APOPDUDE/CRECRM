import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export type PropertyBroker = {
  property_id: string
  contact_id: string
  role: string
  created_at: string
  contact: {
    id: string
    first_name: string
    last_name: string | null
    phone: string | null
    email: string | null
    ghl_contact_id: string | null
    company: { name: string } | null
  } | null
}

/**
 * The brokers attached to a property — today that's "the owner's realtor", written by
 * the call form's Broker section (intake_broker). A real row, not a note, so the owner
 * card can show them next to the owner they represent.
 */
export function usePropertyBrokers(propertyId: string | undefined) {
  return useQuery({
    queryKey: ['property-brokers', propertyId ?? ''],
    enabled: !!propertyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('property_brokers')
        .select(
          '*, contact:contacts!property_brokers_contact_id_fkey(id, first_name, last_name, ' +
            'phone, email, ghl_contact_id, company:companies!contacts_company_id_fkey(name))',
        )
        .eq('property_id', propertyId!)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as unknown as PropertyBroker[]
    },
  })
}

export function useRemovePropertyBroker() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      propertyId,
      contactId,
    }: {
      propertyId: string
      contactId: string
    }) => {
      const { error } = await supabase
        .from('property_brokers')
        .delete()
        .eq('property_id', propertyId)
        .eq('contact_id', contactId)
      if (error) throw error
    },
    onSuccess: (_d, v) =>
      void qc.invalidateQueries({ queryKey: ['property-brokers', v.propertyId] }),
  })
}
