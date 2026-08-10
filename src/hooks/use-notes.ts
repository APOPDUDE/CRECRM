import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Enums, Tables, TablesInsert } from '@/lib/database.types'

export type Note = Tables<'notes'>
/** The entity a note/file/task hangs on (typed FK columns). */
export type ParentType = 'client' | 'listing' | 'pursuit' | 'property'
type NoteKind = Enums<'note_kind'>

const parentColumn = (t: ParentType) =>
  t === 'client'
    ? 'client_id'
    : t === 'listing'
      ? 'listing_id'
      : t === 'property'
        ? 'property_id'
        : 'pursuit_id'

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

/** A property note plus the deal that produced it, for the property page's history. */
export type PropertyNote = Note & {
  pursuit: {
    id: string
    stage: Enums<'pursuit_stage'>
    client_id: string | null
    client: { company: { name: string } | null; contact: { first_name: string; last_name: string | null } | null } | null
  } | null
}

/**
 * Everything ever said about a building, newest first — including tour feedback left by
 * deals that have since died. The pursuit is joined in so the page can name who toured
 * it; a note whose deal was deleted still shows, it just loses the attribution.
 */
export function usePropertyNotes(propertyId: string | undefined) {
  return useQuery({
    queryKey: ['notes', 'property', propertyId ?? ''],
    enabled: !!propertyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notes')
        .select(
          '*, pursuit:pursuits!notes_pursuit_id_fkey(id, stage, client_id, ' +
            'client:clients!pursuits_client_id_fkey(company:companies!clients_company_id_fkey(name), ' +
            'contact:contacts!clients_contact_id_fkey(first_name, last_name)))',
        )
        .eq('property_id', propertyId!)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as unknown as PropertyNote[]
    },
  })
}

/**
 * Tour feedback: filed against the PROPERTY, tagged with the deal that produced it.
 *
 * Both ids on purpose — property_id is where it will be read (the building's history),
 * pursuit_id is who said it. Written even when the reason is blank, because "a tenant
 * walked this and passed" is worth knowing on its own.
 */
export function useCreateTourNote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      propertyId,
      pursuitId,
      body,
    }: {
      propertyId: string
      pursuitId: string
      body: string
    }) => {
      const { data, error } = await supabase
        .from('notes')
        .insert({ property_id: propertyId, pursuit_id: pursuitId, body, kind: 'tour' })
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: (_d, { propertyId, pursuitId }) => {
      queryClient.invalidateQueries({ queryKey: ['notes', 'property', propertyId] })
      queryClient.invalidateQueries({ queryKey: notesKey('pursuit', pursuitId) })
    },
  })
}
