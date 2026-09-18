import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Tables } from '@/lib/database.types'

/**
 * Where people give up on the alexpoplawski.com funnels.
 *
 * `v_funnel_dropoff` counts, per step, how many sessions reached it and how many stopped
 * there — the sessions that never submitted or booked. The people who finish already show
 * up as leads; this is the only view of the ones who don't.
 */
export type FunnelStep = Tables<'v_funnel_dropoff'>

export type FunnelSummary = {
  sessions: number
  finished: number
  steps: FunnelStep[]
}

export function useFunnelDropoff(days = 30) {
  return useQuery({
    queryKey: ['funnel_dropoff', days],
    queryFn: async (): Promise<Record<string, FunnelSummary>> => {
      const since = new Date(Date.now() - days * 86_400_000).toISOString()

      const [{ data: steps, error }, { data: sessions, error: sErr }] = await Promise.all([
        supabase.from('v_funnel_dropoff').select('*').limit(500),
        supabase
          .from('funnel_events')
          .select('session_id, form, track, event')
          .gte('occurred_at', since)
          .limit(20_000),
      ])
      if (error) throw error
      if (sErr) throw sErr

      // A session has no track until the visitor picks one, so resolve each session to the
      // track it ended on first — otherwise every session is counted twice, once under its
      // early null-track events and once under the real one. Same rule the view uses.
      const resolved = new Map<string, { form: string; track: string; done: boolean }>()
      for (const e of sessions ?? []) {
        const cur = resolved.get(e.session_id) ?? { form: e.form, track: 'undecided', done: false }
        if (e.track) cur.track = e.track
        if (e.event === 'submit' || e.event === 'book') cur.done = true
        resolved.set(e.session_id, cur)
      }
      const started = new Map<string, Set<string>>()
      const done = new Map<string, Set<string>>()
      for (const [sid, r] of resolved) {
        const key = `${r.form}|${r.track}`
        if (!started.has(key)) started.set(key, new Set())
        started.get(key)!.add(sid)
        if (r.done) {
          if (!done.has(key)) done.set(key, new Set())
          done.get(key)!.add(sid)
        }
      }

      const out: Record<string, FunnelSummary> = {}
      for (const s of steps ?? []) {
        const key = `${s.form}|${s.track ?? 'undecided'}`
        if (!out[key]) {
          out[key] = {
            sessions: started.get(key)?.size ?? 0,
            finished: done.get(key)?.size ?? 0,
            steps: [],
          }
        }
        out[key].steps.push(s)
      }
      for (const v of Object.values(out)) {
        v.steps.sort((a, b) => (a.step_index ?? 999) - (b.step_index ?? 999))
      }
      return out
    },
    staleTime: 5 * 60_000,
  })
}
