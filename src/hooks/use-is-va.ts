import { useAuth } from '@/hooks/use-auth'

/**
 * A VA login is a Supabase auth user whose JWT carries app_metadata.crm_role === 'va'.
 * This gates the UI only (which shell renders, which routes exist) — the real wall is
 * server-side: RLS lets the VA read just the six texting tables, and every VA write
 * goes through the va_* SECURITY DEFINER RPCs. Nothing here is load-bearing for security.
 */
export function useIsVa(): boolean {
  const { session } = useAuth()
  return session?.user.app_metadata?.crm_role === 'va'
}
