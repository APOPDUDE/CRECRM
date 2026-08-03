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
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      queryClient.invalidateQueries({ queryKey: ['owner-conversations'] })
      queryClient.invalidateQueries({ queryKey: ['owner-context'] })
    },
  })
}
