import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Tables, TablesInsert, TablesUpdate } from '@/lib/database.types'

export type Property = Tables<'properties'>

export function useProperties() {
  return useQuery({
    queryKey: ['properties'],
    queryFn: async () => {
      const { data, error } = await supabase.from('properties').select('*').order('address')
      if (error) throw error
      return data
    },
  })
}

export function useProperty(id: string | undefined) {
  return useQuery({
    queryKey: ['properties', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('properties').select('*').eq('id', id!).single()
      if (error) throw error
      return data
    },
  })
}

export function useCreateProperty() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (values: TablesInsert<'properties'>) => {
      const { data, error } = await supabase.from('properties').insert(values).select().single()
      if (error) throw error
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['properties'] }),
  })
}

export function useUpdateProperty() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...values }: TablesUpdate<'properties'> & { id: string }) => {
      const { data, error } = await supabase.from('properties').update(values).eq('id', id).select().single()
      if (error) throw error
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['properties'] }),
  })
}

export function useDeleteProperty() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('properties').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['properties'] }),
  })
}
