import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Enums, Tables, TablesInsert, TablesUpdate } from '@/lib/database.types'
import type { ParentType } from '@/hooks/use-notes'

export type TaskWithContact = Tables<'tasks'> & {
  contact: Pick<Tables<'contacts'>, 'id' | 'first_name' | 'last_name'> | null
}

const TASK_SELECT = `
  *,
  contact:contacts!tasks_contact_id_fkey(id, first_name, last_name)
`

export const taskKindLabels: Record<Enums<'task_kind'>, string> = {
  renewal: 'Renewal',
  follow_up: 'Follow-up',
  general: 'Task',
}

/** Route into the deal a task is attached to, for the "click task -> open deal" flow. */
export function taskDealPath(
  task: Pick<Tables<'tasks'>, 'client_id' | 'listing_id' | 'pursuit_id'>,
): string | null {
  if (task.client_id) return `/tenant-rep/${task.client_id}`
  if (task.listing_id) return `/landlord-rep/${task.listing_id}`
  return null
}

export function useTasks() {
  return useQuery({
    queryKey: ['tasks'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select(TASK_SELECT)
        .order('due_date', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as unknown as TaskWithContact[]
    },
  })
}

export function useCreateTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (values: TablesInsert<'tasks'>) => {
      const { data, error } = await supabase.from('tasks').insert(values).select().single()
      if (error) throw error
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  })
}

export function useUpdateTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...values }: TablesUpdate<'tasks'> & { id: string }) => {
      const { error } = await supabase.from('tasks').update(values).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  })
}

/** Optimistic open/done toggle so checking a task off feels instant. */
export function useToggleTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: Enums<'task_status'> }) => {
      const { error } = await supabase
        .from('tasks')
        .update({ status, completed_at: status === 'done' ? new Date().toISOString() : null })
        .eq('id', id)
      if (error) throw error
    },
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: ['tasks'] })
      const previous = queryClient.getQueryData<TaskWithContact[]>(['tasks'])
      queryClient.setQueryData<TaskWithContact[]>(['tasks'], (old) =>
        old?.map((t) => (t.id === id ? { ...t, status } : t)),
      )
      return { previous }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(['tasks'], ctx.previous)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  })
}

const parentColumn = (t: ParentType) =>
  t === 'client' ? 'client_id' : t === 'listing' ? 'listing_id' : 'pursuit_id'

/** Create/replace the auto-generated lease-renewal reminder for a pursuit. */
export function useUpsertRenewalTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      owner: string
      pursuitId: string
      parentType: ParentType
      parentId: string
      contactId: string | null
      title: string
      dueDate: string
    }) => {
      // replace any existing open auto renewal task for THIS pursuit
      await supabase
        .from('tasks')
        .delete()
        .eq('pursuit_id', args.pursuitId)
        .eq('source', 'lease_renewal')
        .eq('status', 'open')
      const { error } = await supabase.from('tasks').insert({
        owner_id: args.owner,
        title: args.title,
        kind: 'renewal',
        due_date: args.dueDate,
        pursuit_id: args.pursuitId,
        [parentColumn(args.parentType)]: args.parentId,
        contact_id: args.contactId,
        auto_generated: true,
        source: 'lease_renewal',
      } as TablesInsert<'tasks'>)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  })
}

export function useDeleteTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('tasks').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  })
}
