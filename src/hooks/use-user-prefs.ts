import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Json } from '@/lib/database.types'

/**
 * A preference that follows Alex across devices (`user_prefs`, one jsonb row per key)
 * — localStorage state stays on one browser, and the phone is half the point of the
 * app. First tenant: the export dialog's saved column presets.
 *
 * `loaded` gates one-time migrations from a localStorage predecessor: only after the
 * server has actually answered can "empty" be trusted to mean empty.
 */
export function useUserPref<T extends Json>(key: string, fallback: T) {
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: ['user-pref', key],
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<T | null> => {
      const { data, error } = await supabase
        .from('user_prefs')
        .select('value')
        .eq('key', key)
        .maybeSingle()
      if (error) throw error
      return (data?.value as T) ?? null
    },
  })
  const save = useMutation({
    mutationFn: async (value: T) => {
      const { error } = await supabase
        .from('user_prefs')
        .upsert({ key, value, updated_at: new Date().toISOString() })
      if (error) throw error
      return value
    },
    onSuccess: (value) => qc.setQueryData(['user-pref', key], value),
  })
  return {
    value: (query.data ?? fallback) as T,
    loaded: query.isSuccess,
    save: (value: T) => save.mutate(value),
  }
}
