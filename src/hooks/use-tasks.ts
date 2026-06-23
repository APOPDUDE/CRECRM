import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { addMonths, format } from 'date-fns'
import { supabase } from '@/lib/supabase'
import type { Enums, Tables, TablesInsert, TablesUpdate } from '@/lib/database.types'
import type { ParentType } from '@/hooks/use-notes'

export type TaskWithContact = Tables<'tasks'> & {
  contact: Pick<Tables<'contacts'>, 'id' | 'first_name' | 'last_name'> | null
  /** When a task hangs off a pursuit (e.g. payment checks), its client for routing. */
  pursuit: { client_id: string } | null
}

const TASK_SELECT = `
  *,
  contact:contacts!tasks_contact_id_fkey(id, first_name, last_name),
  pursuit:pursuits!tasks_pursuit_id_fkey(client_id)
`

export const taskKindLabels: Record<Enums<'task_kind'>, string> = {
  renewal: 'Renewal',
  follow_up: 'Follow-up',
  general: 'Task',
  tour: 'Tour',
}

/** Route into the deal a task is attached to, for the "click task -> open deal" flow. */
export function taskDealPath(
  task: Pick<Tables<'tasks'>, 'client_id' | 'listing_id' | 'pursuit_id'> & {
    pursuit?: { client_id: string } | null
  },
): string | null {
  if (task.client_id) return `/tenant-rep/${task.client_id}`
  if (task.listing_id) return `/landlord-rep/${task.listing_id}`
  if (task.pursuit?.client_id) return `/tenant-rep/${task.pursuit.client_id}`
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

export type PropertyTask = Tables<'tasks'> & {
  pursuit:
    | {
        client_id: string
        client: {
          company: { name: string } | null
          contact: { first_name: string; last_name: string | null } | null
        } | null
      }
    | null
}

/** Open tasks attached to any pursuit on this property (tours, follow-ups, etc.). */
export function usePropertyTasks(propertyId: string | undefined) {
  return useQuery({
    queryKey: ['tasks', 'property', propertyId],
    enabled: !!propertyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select(
          `*, pursuit:pursuits!tasks_pursuit_id_fkey!inner(client_id, property_id, client:clients!pursuits_client_id_fkey(company:companies!clients_company_id_fkey(name), contact:contacts!clients_contact_id_fkey(first_name, last_name)))`,
        )
        .eq('pursuit.property_id', propertyId!)
        .eq('status', 'open')
        .order('due_at', { ascending: true, nullsFirst: false })
        .order('due_date', { ascending: true, nullsFirst: false })
      if (error) throw error
      return data as unknown as PropertyTask[]
    },
  })
}

/**
 * Edit a tour's date and/or time from the property page. Updates the task's due_date +
 * due_at AND the linked pursuit's tour_date + tour_time so the board card, slide-over,
 * and property page stay in sync.
 */
export function useUpdateTourTime() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      taskId,
      pursuitId,
      date,
      time,
    }: {
      taskId: string
      pursuitId: string | null
      date: string | null
      time: string | null
    }) => {
      const dueAt = date && time ? new Date(`${date}T${time}`).toISOString() : null
      const { error } = await supabase
        .from('tasks')
        .update({ due_date: date || null, due_at: dueAt })
        .eq('id', taskId)
      if (error) throw error
      if (pursuitId) {
        const { error: e2 } = await supabase
          .from('pursuits')
          .update({ tour_date: date || null, tour_time: time || null })
          .eq('id', pursuitId)
        if (e2) throw e2
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      queryClient.invalidateQueries({ queryKey: ['matches'] })
    },
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

/**
 * Resolve a pursuit's monthly "payment received?" check from the board, immediately (no
 * waiting on the daily sweep): marking received closes any open payment reminders; marking
 * NOT received sets the next reminder a month out so it's visible on the task list right away.
 */
export function usePaymentReceivedToggle() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      pursuitId,
      received,
      ownerId,
      title,
    }: {
      pursuitId: string
      received: boolean
      ownerId: string
      title: string
    }) => {
      const { error: pErr } = await supabase
        .from('pursuits')
        .update({ payment_received: received })
        .eq('id', pursuitId)
      if (pErr) throw pErr

      if (received) {
        // stop reminding — close any open payment checks for this deal
        await supabase
          .from('tasks')
          .update({ status: 'done', completed_at: new Date().toISOString() })
          .eq('pursuit_id', pursuitId)
          .eq('source', 'payment_check')
          .eq('status', 'open')
      } else {
        // not received — make sure exactly one open reminder exists, a month out
        const { data: openChecks } = await supabase
          .from('tasks')
          .select('id')
          .eq('pursuit_id', pursuitId)
          .eq('source', 'payment_check')
          .eq('status', 'open')
          .limit(1)
        if (!openChecks || openChecks.length === 0) {
          const { error: tErr } = await supabase.from('tasks').insert({
            owner_id: ownerId,
            title,
            kind: 'follow_up',
            status: 'open',
            due_date: format(addMonths(new Date(), 1), 'yyyy-MM-dd'),
            pursuit_id: pursuitId,
            auto_generated: true,
            source: 'payment_check',
          })
          if (tErr) throw tErr
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      queryClient.invalidateQueries({ queryKey: ['matches'] })
      queryClient.invalidateQueries({ queryKey: ['tenant_reps'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-matches'] })
    },
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
