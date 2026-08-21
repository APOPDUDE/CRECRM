import { useMutation, useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

/**
 * The outreach spine, from the app's side. Lists live in Supabase (outreach_targets.lists) —
 * one person imported once, pre-loaded on every channel they have data for. Each channel page
 * (Email / Calls & texts / Postcards) picks lists here and asks its own audience RPC who is
 * reachable on that channel and why the rest are held.
 */

export type OutreachList = {
  list: string | null
  targets: number | null
  with_email: number | null
  with_phone: number | null
  with_mail: number | null
  with_property: number | null
  reached: number | null
  never_answered: number | null
  held: number | null
  last_import_at: string | null
}

export function useOutreachLists() {
  return useQuery({
    queryKey: ['outreach-lists'],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<OutreachList[]> => {
      const { data, error } = await supabase
        .from('v_outreach_lists')
        .select('*')
        .order('targets', { ascending: false })
      if (error) throw error
      return data ?? []
    },
  })
}

/* ------------------------------------------------------------------ the phone channel */

export type CallableRow = {
  phone: string
  first_name?: string
  last_name?: string
  company_name?: string
  email?: string
  line_type?: string
  phone_grade?: string
  disposition?: string
  attempts?: number
  last_call_at?: string
  ghl_contact_id?: string
  property_address?: string
  property_city?: string
  property_county?: string
  crm_contact_id?: string
  crm_property_id?: string
  lists?: string[]
}

export type CallAudience = {
  ok: boolean
  reason?: string
  counts: { pool_total: number; considered: number; callable: number; held: number }
  callable: CallableRow[]
  held: { phone: string; reason: string; first_name?: string; last_name?: string }[]
}

export function useCallAudiencePreview() {
  return useMutation({
    mutationFn: async (req: { lists: string[]; recent_days: number }): Promise<CallAudience> => {
      const { data, error } = await supabase.rpc('outreach_call_audience', { p: req })
      if (error) throw error
      return data as unknown as CallAudience
    },
  })
}

/* ------------------------------------------------------------------ the postcard channel */

export type MailableRow = {
  first_name?: string
  last_name?: string
  company_name?: string
  mail_address: string
  mail_city?: string
  mail_state?: string
  mail_zip?: string
  mail_source?: 'owner_county' | 'skiptrace'
  sent_at?: string
  mail_status?: string
  property_address?: string
  property_city?: string
  property_county?: string
  property_state?: string
  property_zip?: string
  crm_contact_id?: string
  crm_property_id?: string
  lists?: string[]
}

export type MailAudience = {
  ok: boolean
  reason?: string
  counts: { pool_total: number; considered: number; mailable: number; held: number }
  mailable: MailableRow[]
  held: { mail_address: string; reason: string; first_name?: string; last_name?: string }[]
}

export function useMailAudiencePreview() {
  return useMutation({
    mutationFn: async (req: { lists: string[]; recent_days: number }): Promise<MailAudience> => {
      const { data, error } = await supabase.rpc('outreach_mail_audience', { p: req })
      if (error) throw error
      return data as unknown as MailAudience
    },
  })
}

/** Plain-English labels for the channel hold reasons. */
export const CHANNEL_HOLD_LABELS: Record<string, string> = {
  wrong_person: 'Confirmed wrong person',
  dnc: 'Do-not-call number',
  bad_number: 'Bad number',
  said_no: 'Already said no',
  'said_no:phone': 'Already said no (phone)',
  called_recently: 'Called recently',
  mailed_recently: 'Mailed recently',
}

export function channelHoldLabel(reason: string): string {
  return CHANNEL_HOLD_LABELS[reason] ?? reason.replace(/_/g, ' ')
}
