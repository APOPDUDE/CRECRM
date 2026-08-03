import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Tables, TablesInsert } from '@/lib/database.types'

export type Communication = Tables<'communications'>

/** Everything logged against one contact — calls, notes, emails — newest first. */
export function useContactConversations(contactId: string | undefined) {
  return useQuery({
    queryKey: ['conversations', 'contact', contactId],
    enabled: !!contactId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('communications')
        .select('*')
        .eq('contact_id', contactId!)
        .order('occurred_at', { ascending: false })
        .limit(200)
      if (error) throw error
      return (data ?? []) as Communication[]
    },
  })
}

/**
 * Manual note into the conversation history. The communications CHECK requires a contact
 * or phone identity, so callers must supply contact_id (owner/property ids are optional
 * context that make the note surface on those pages too).
 */
export function useAddCommNote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (
      v: Pick<TablesInsert<'communications'>, 'contact_id' | 'owner_id' | 'property_id' | 'body'>,
    ) => {
      const { error } = await supabase.from('communications').insert({
        ...v,
        channel: 'note',
        direction: 'unknown',
        source: 'manual',
        occurred_at: new Date().toISOString(),
      })
      if (error) {
        // 23503: the target contact no longer exists — almost always a page rendered from
        // cache after a contact merge. Refresh the data so the retry hits the survivor.
        if (error.code === '23503') {
          queryClient.invalidateQueries({ queryKey: ['owner-contacts'] })
          queryClient.invalidateQueries({ queryKey: ['contacts'] })
          queryClient.invalidateQueries({ queryKey: ['conversations'] })
          throw new Error('this contact was merged into another record — the page has refreshed, try again')
        }
        throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      queryClient.invalidateQueries({ queryKey: ['owner-conversations'] })
      queryClient.invalidateQueries({ queryKey: ['owner-context'] })
    },
  })
}


/** Edit a note's text. Only manual notes are editable — imported calls are records. */
export function useUpdateCommNote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (v: { id: string; body: string }) => {
      const { error } = await supabase
        .from('communications')
        .update({ body: v.body })
        .eq('id', v.id)
        .eq('source', 'manual')
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      queryClient.invalidateQueries({ queryKey: ['owner-conversations'] })
    },
  })
}

/** Delete a conversation entry (any source — confirmed by the caller). */
export function useDeleteComm() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('communications').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      queryClient.invalidateQueries({ queryKey: ['owner-conversations'] })
      queryClient.invalidateQueries({ queryKey: ['owner-context'] })
    },
  })
}
