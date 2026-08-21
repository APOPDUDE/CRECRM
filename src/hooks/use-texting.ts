import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Enums, Tables } from '@/lib/database.types'
import { normalizePhone } from '@/lib/format'

/**
 * The texting channel, from the console's side. The VA can SELECT the six texting tables
 * (outreach_texts, text_messages, text_campaigns, text_sends, phone_suppressions,
 * texting_settings) and write ONLY through the va_* SECURITY DEFINER RPCs — anything else
 * is blocked server-side, so every mutation here is an RPC call, never a table write.
 * Alex has full access; the campaigns/settings hooks that write tables directly are
 * mounted behind Alex-only routes.
 */

export type TextThread = Tables<'outreach_texts'>
export type TextSend = Tables<'text_sends'>
export type TextCampaign = Tables<'text_campaigns'>
export type TextingSettings = Tables<'texting_settings'>
export type TextSendStatus = Enums<'text_send_status'>

/** Sentence-case labels for the AI triage chips on queue cards. */
export const TRIAGE_LABELS: Record<Enums<'triage_label'>, string> = {
  owner_yes: 'Owner yes',
  wrong_person: 'Wrong person',
  not_interested: 'Not interested',
  opt_out: 'Opt out',
  hostile_legal: 'Hostile / legal',
  question: 'Question',
  autoreply: 'Auto-reply',
  unknown: 'Unknown',
}

/* ------------------------------------------------------------------ the reply queue */

export type QueueThread = TextThread & { preview: string | null }

/**
 * Threads waiting on a human — oldest inbound first, so nobody waits longer than they
 * must. Each card carries a one-line preview of the latest inbound message; that is a
 * second query, not an embed, because text_messages joins outreach_texts by phone, not FK.
 */
export function useVaQueue() {
  return useQuery({
    queryKey: ['texting', 'queue'],
    refetchInterval: 15_000,
    queryFn: async (): Promise<QueueThread[]> => {
      const { data: threads, error } = await supabase
        .from('outreach_texts')
        .select('*')
        .eq('queue_state', 'awaiting_va')
        .order('last_inbound_at', { ascending: true })
        .limit(500)
      if (error) throw error
      if (!threads?.length) return []

      // No .in(phone) filter: the DB stores phones as received (Blooio '+1813…' vs the
      // spine's formatting), and PostgREST filters compare the raw column — an exact
      // match would silently miss. Pull recent inbound and match on normalized phone.
      const { data: msgs, error: msgErr } = await supabase
        .from('text_messages')
        .select('phone, body, created_at')
        .eq('direction', 'inbound')
        .order('created_at', { ascending: false })
        .limit(1000)
      if (msgErr) throw msgErr

      // Newest-first, so the first body we see per phone is the latest inbound.
      const latest = new Map<string, string>()
      for (const m of msgs ?? []) {
        const key = normalizePhone(m.phone) ?? m.phone
        if (!latest.has(key) && m.body) latest.set(key, m.body)
      }
      return threads.map((t) => ({
        ...t,
        preview: latest.get(normalizePhone(t.phone) ?? t.phone) ?? null,
      }))
    },
  })
}

/* ------------------------------------------------------------------ one thread */

export type ThreadMessage = {
  id: string
  direction: Enums<'msg_direction'>
  body: string | null
  protocol: Enums<'msg_protocol'>
  status: string
  sent_at: string | null
  delivered_at: string | null
  read_at: string | null
  created_at: string
}

/** One phone can be several flagged identities (shared landline) — disambiguate when >1. */
export type ThreadCandidate = {
  target_id: string
  name: string | null
  company_name: string | null
  property_id: string | null
  property_address: string | null
}

export type VaThreadContext = {
  phone: string
  thread: TextThread | null
  messages: ThreadMessage[]
  candidates: ThreadCandidate[]
}

/** Thread + transcript (last 50, chronological) + candidate identities, in one RPC. */
export function useThreadContext(phone: string | undefined) {
  return useQuery({
    queryKey: ['texting', 'thread', phone],
    enabled: !!phone,
    queryFn: async (): Promise<VaThreadContext> => {
      const { data, error } = await supabase.rpc('va_thread_context', { p_phone: phone! })
      if (error) throw error
      return data as unknown as VaThreadContext
    },
  })
}

/* ------------------------------------------------------------------ VA actions (RPCs) */

function useInvalidateTexting() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: ['texting'] })
}

/** Free-text reply — the RPC refuses unless the person has texted in first. */
export function useVaSendReply() {
  const invalidate = useInvalidateTexting()
  return useMutation({
    mutationFn: async (req: { phone: string; body: string }) => {
      const { data, error } = await supabase.rpc('va_send_reply', {
        p_phone: req.phone,
        p_body: req.body,
      })
      if (error) throw error
      return data
    },
    onSuccess: invalidate,
  })
}

/** "Yes, this is the owner" — mints/updates a verified contact (verified_by = 'va_text'). */
export function useVaConfirmOwner() {
  const invalidate = useInvalidateTexting()
  return useMutation({
    mutationFn: async (req: {
      phone: string
      target_id: string
      first_name: string
      last_name: string
    }) => {
      const { data, error } = await supabase.rpc('va_confirm_owner', {
        p_phone: req.phone,
        p_target_id: req.target_id,
        p_first_name: req.first_name,
        p_last_name: req.last_name,
      })
      if (error) throw error
      return data
    },
    onSuccess: invalidate,
  })
}

/** Wrong person: marks the calls, suppresses the number for texts, closes the thread. */
export function useVaWrongPerson() {
  const invalidate = useInvalidateTexting()
  return useMutation({
    mutationFn: async (phone: string) => {
      const { data, error } = await supabase.rpc('va_wrong_person', { p_phone: phone })
      if (error) throw error
      return data
    },
    onSuccess: invalidate,
  })
}

/** Not interested: 12-month said_no suppression, dispositions the calls, closes the thread. */
export function useVaNotInterested() {
  const invalidate = useInvalidateTexting()
  return useMutation({
    mutationFn: async (phone: string) => {
      const { data, error } = await supabase.rpc('va_not_interested', { p_phone: phone })
      if (error) throw error
      return data
    },
    onSuccess: invalidate,
  })
}

/**
 * The per-row "send" tap: flips a draft to approved (the FTSA human-initiation step).
 * Returns { ok, send_id, reason? } — an already-moved row comes back ok:false, not an error.
 */
export function useVaApproveSend() {
  const invalidate = useInvalidateTexting()
  return useMutation({
    mutationFn: async (sendId: string): Promise<{ ok: boolean; reason?: string }> => {
      const { data, error } = await supabase.rpc('va_approve_send', { p_send_id: sendId })
      if (error) throw error
      return data as unknown as { ok: boolean; reason?: string }
    },
    onSuccess: invalidate,
  })
}

/* ------------------------------------------------------------------ today's batch */

export type TodaysSend = TextSend & { campaign: { id: string; name: string } | null }

/**
 * Every queue row created today, grouped by campaign on the page. The status filter is
 * the whole enum on purpose: a row the VA taps moves draft → approved → queued → sending
 * → sent → delivered, and it must not vanish from the list mid-flight.
 */
export function useTodaysSends() {
  return useQuery({
    queryKey: ['texting', 'sends', 'today'],
    refetchInterval: 15_000,
    queryFn: async (): Promise<TodaysSend[]> => {
      const start = new Date()
      start.setHours(0, 0, 0, 0)
      const { data, error } = await supabase
        .from('text_sends')
        .select('*, campaign:text_campaigns(id, name)')
        .gte('created_at', start.toISOString())
        .order('created_at', { ascending: true })
        .limit(2000)
      if (error) throw error
      return (data ?? []) as unknown as TodaysSend[]
    },
  })
}

/* ------------------------------------------------------------------ settings (singleton) */

/** The id=1 singleton. The VA can read it (for the paused banner); only Alex writes it. */
export function useTextingSettings() {
  return useQuery({
    queryKey: ['texting', 'settings'],
    queryFn: async (): Promise<TextingSettings | null> => {
      const { data, error } = await supabase
        .from('texting_settings')
        .select('*')
        .eq('id', 1)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })
}

export type TextingSettingsPatch = Partial<
  Pick<
    TextingSettings,
    'paused' | 'quiet_start' | 'quiet_cutoff' | 'per_line_daily_cap' | 'ramp_started_on'
  >
>

/** Alex-only: direct table write, mounted behind the Alex-only settings route. */
export function useUpdateTextingSettings() {
  const invalidate = useInvalidateTexting()
  return useMutation({
    mutationFn: async (patch: TextingSettingsPatch) => {
      const { error } = await supabase.from('texting_settings').update(patch).eq('id', 1)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

/* ------------------------------------------------------------------ campaigns (Alex-only) */

export type CampaignWithCounts = TextCampaign & {
  sendCounts: Partial<Record<TextSendStatus, number>>
  totalSends: number
}

export function useTextCampaigns() {
  return useQuery({
    queryKey: ['texting', 'campaigns'],
    queryFn: async (): Promise<CampaignWithCounts[]> => {
      const campaignsRes = await supabase
        .from('text_campaigns')
        .select('*')
        .order('created_at', { ascending: false })
      if (campaignsRes.error) throw campaignsRes.error

      // Two columns across the whole table, grouped here — PostgREST can't GROUP BY,
      // and the server caps every response at 1000 rows no matter what .limit() asks
      // for. Page in 1000-row windows until a short page so counts stay exact.
      const counts = new Map<string, Partial<Record<TextSendStatus, number>>>()
      const page = 1000
      for (let from = 0; ; from += page) {
        const sendsRes = await supabase
          .from('text_sends')
          .select('campaign_id, status')
          .order('id')
          .range(from, from + page - 1)
        if (sendsRes.error) throw sendsRes.error
        for (const s of sendsRes.data ?? []) {
          if (!s.campaign_id) continue
          const c = counts.get(s.campaign_id) ?? {}
          c[s.status] = (c[s.status] ?? 0) + 1
          counts.set(s.campaign_id, c)
        }
        if ((sendsRes.data ?? []).length < page) break
      }
      return (campaignsRes.data ?? []).map((c) => {
        const sendCounts = counts.get(c.id) ?? {}
        return {
          ...c,
          sendCounts,
          totalSends: Object.values(sendCounts).reduce((a, b) => a + b, 0),
        }
      })
    },
  })
}

/** Alex-only: direct insert. Enqueueing an audience arrives with the send pipeline. */
export function useCreateTextCampaign() {
  const invalidate = useInvalidateTexting()
  return useMutation({
    mutationFn: async (req: { name: string; template: string; daily_cap: number }) => {
      const { error } = await supabase.from('text_campaigns').insert(req)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

/* ------------------------------------------------------------------ suppressions */

/** Read-only summary for the settings page: how many numbers are held, and why. */
export function useSuppressionSummary() {
  return useQuery({
    queryKey: ['texting', 'suppressions'],
    queryFn: async (): Promise<{ reason: string; count: number }[]> => {
      const { data, error } = await supabase
        .from('phone_suppressions')
        .select('reason')
        .limit(10000)
      if (error) throw error
      const counts = new Map<string, number>()
      for (const row of data ?? []) counts.set(row.reason, (counts.get(row.reason) ?? 0) + 1)
      return [...counts.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count)
    },
  })
}
