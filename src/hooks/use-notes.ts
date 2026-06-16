import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Enums, Tables, TablesInsert } from '@/lib/database.types'

export type Note = Tables<'notes'>
/** The deal entity a note/file/task hangs on (typed FK columns). */
export type ParentType = 'client' | 'listing' | 'pursuit'
type NoteKind = Enums<'note_kind'>

const parentColumn = (t: ParentType) =>
  t === 'client' ? 'client_id' : t === 'listing' ? 'listing_id' : 'pursuit_id'

const notesKey = (parentType: ParentType, parentId: string) => ['notes', parentType, parentId]

export function useNotes(parentType: ParentType, parentId: string | undefined) {
  return useQuery({
    queryKey: notesKey(parentType, parentId ?? ''),
    enabled: !!parentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notes')
        .select('*')
        .eq(parentColumn(parentType), parentId!)
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
      parentType,
      parentId,
      body,
      kind = 'note',
    }: {
      parentType: ParentType
      parentId: string
      body: string
      kind?: NoteKind
    }) => {
      const { data, error } = await supabase
        .from('notes')
        .insert({ [parentColumn(parentType)]: parentId, body, kind } as TablesInsert<'notes'>)
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: (_data, { parentType, parentId }) =>
      queryClient.invalidateQueries({ queryKey: notesKey(parentType, parentId) }),
  })
}

export function useUpdateNote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      body,
    }: {
      id: string
      parentType: ParentType
      parentId: string
      body: string
    }) => {
      const { data, error } = await supabase
        .from('notes')
        .update({ body })
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: (_data, { parentType, parentId }) =>
      queryClient.invalidateQueries({ queryKey: notesKey(parentType, parentId) }),
  })
}

export function useDeleteNote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }: { id: string; parentType: ParentType; parentId: string }) => {
      const { error } = await supabase.from('notes').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: (_data, { parentType, parentId }) =>
      queryClient.invalidateQueries({ queryKey: notesKey(parentType, parentId) }),
  })
}
