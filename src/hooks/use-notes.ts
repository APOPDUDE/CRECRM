import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Enums, Tables } from '@/lib/database.types'

export type Note = Tables<'notes'>
type NoteEntity = Enums<'note_entity'>

const notesKey = (entityType: NoteEntity, entityId: string) => ['notes', entityType, entityId]

export function useNotes(entityType: NoteEntity, entityId: string | undefined) {
  return useQuery({
    queryKey: notesKey(entityType, entityId ?? ''),
    enabled: !!entityId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notes')
        .select('*')
        .eq('entity_type', entityType)
        .eq('entity_id', entityId!)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
  })
}

export function useCreateNote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      entityType,
      entityId,
      body,
    }: {
      entityType: NoteEntity
      entityId: string
      body: string
    }) => {
      const { data, error } = await supabase
        .from('notes')
        .insert({ entity_type: entityType, entity_id: entityId, body })
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: (_data, { entityType, entityId }) =>
      queryClient.invalidateQueries({ queryKey: notesKey(entityType, entityId) }),
  })
}
