import { useMutation, useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { callN8nWebhook, N8N_PATHS } from '@/lib/n8n'
import type { Tables } from '@/lib/database.types'

export type EmailTemplate = Tables<'email_sequence_templates'>

/** One variant of one step. Several variants on step 1 is an A/B test — Smartlead rotates them. */
export type TemplateVariant = { label: string; subject: string; body: string }
export type TemplateStep = { seq_number: number; delay_days: number; variants: TemplateVariant[] }

/** `steps` is jsonb, so it arrives as `Json`. Narrow it once, here, rather than at every use. */
export function templateSteps(t: EmailTemplate | undefined | null): TemplateStep[] {
  if (!t || !Array.isArray(t.steps)) return []
  return (t.steps as unknown as TemplateStep[]).filter((s) => s && Array.isArray(s.variants))
}

/**
 * The copy library. Small and slow-changing, so it is cached hard — the picker re-renders on
 * every keystroke in the composer and should never re-fetch.
 */
export function useEmailTemplates() {
  return useQuery({
    queryKey: ['email-sequence-templates'],
    staleTime: 30 * 60_000,
    queryFn: async (): Promise<EmailTemplate[]> => {
      const { data, error } = await supabase
        .from('email_sequence_templates')
        .select('*')
        .eq('is_active', true)
        .order('purpose')
        .order('name')
      if (error) throw error
      return data ?? []
    },
  })
}

/** One deduped, suppression-checked address, exactly as email_audience_build returns it. */
export type AudienceLead = {
  email: string
  first_name: string | null
  last_name: string | null
  phone_number: string | null
  company_name: string | null
  custom_fields: Record<string, string | null>
  ghl_contact_ids: string[] | null
  /** how many GHL rows collapsed into this one address — Terrakotta writes one row per phone */
  ghl_rows_collapsed: number
  crm_contact_id: string | null
  crm_property_id: string | null
  domain_type: 'consumer' | 'business'
}

export type AudienceHold = {
  email: string
  reason: string
  first_name?: string | null
  last_name?: string | null
  property_address?: string | null
  ghl_rows?: number
}

export type AudiencePreview = {
  ok: boolean
  reason?: string
  dry_run: boolean
  audience: string | null
  counts: {
    ghl_rows: number
    address_rows: number
    addresses: number
    sendable: number
    held: number
    contacts_minted: number
  }
  sendable: AudienceLead[]
  held: AudienceHold[]
}

export type AudienceRequest = {
  tags: string[]
  audience: string
  allow_business_domains: boolean
  recent_days: number
}

/**
 * Preview an audience. Goes out through n8n because the GHL private token must never reach the
 * browser bundle; n8n pages GHL, flattens the custom fields, and hands the rows to the
 * email_audience_build RPC. Always a dry run — the preview must not have already changed the
 * book by the time Alex reads it.
 */
export function useAudiencePreview() {
  return useMutation({
    mutationFn: async (req: AudienceRequest): Promise<AudiencePreview> =>
      callN8nWebhook<AudiencePreview>(
        `${N8N_PATHS.emailAudience}?key=axis-2026`,
        { ...req, dry_run: true },
        { timeoutMs: 180_000 },
      ),
  })
}

export type LaunchRequest = AudienceRequest & {
  template_key: string
  campaign_name: string
  daily_cap: number
  /** 'stage' leaves the Smartlead campaign DRAFTED for a human to start; 'send' starts it. */
  mode: 'stage' | 'send'
}

export type LaunchResult = { queued?: boolean; campaign_name?: string; message?: string }

/**
 * Build the campaign in Smartlead. Answers immediately with `queued` and keeps working in the
 * background — enrolling a few hundred leads runs far past any HTTP timeout, and Cloudflare
 * closes the response near 100s.
 */
export function useLaunchEmailCampaign() {
  return useMutation({
    mutationFn: async (req: LaunchRequest): Promise<LaunchResult> =>
      callN8nWebhook<LaunchResult>(`${N8N_PATHS.emailLaunch}?key=axis-2026`, req, {
        timeoutMs: 120_000,
      }),
  })
}

/**
 * Render a template the way Smartlead will: {{token}} substituted from the lead's custom_fields,
 * anything unknown left visibly intact so a missing field shows up in the preview instead of
 * silently shipping a blank. `%signature%` is Smartlead's own token and stays as-is.
 *
 * This mirrors the merge vocabulary pinned by email_merge_fields() in the database. If the two
 * ever drift, the CHECK on email_sequence_templates fails first — which is the point.
 */
export function renderTemplate(text: string, lead: AudienceLead | undefined): string {
  if (!lead) return text
  const values: Record<string, string> = {}
  for (const [k, v] of Object.entries(lead.custom_fields ?? {})) {
    if (v != null && v !== '') values[k] = String(v)
  }
  values.unsubscribe = '[unsubscribe link]'
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (whole, token: string) =>
    Object.prototype.hasOwnProperty.call(values, token) ? values[token] : whole,
  )
}

/** Tokens the lead cannot fill — the preview flags these rather than shipping an empty gap. */
export function missingTokens(text: string, lead: AudienceLead | undefined): string[] {
  if (!lead) return []
  const have = new Set(
    Object.entries(lead.custom_fields ?? {})
      .filter(([, v]) => v != null && v !== '')
      .map(([k]) => k),
  )
  have.add('unsubscribe')
  const out = new Set<string>()
  for (const m of text.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) {
    if (!have.has(m[1])) out.add(m[1])
  }
  return [...out]
}

/** Plain-English labels for the hold reasons email_audience_build emits. */
export const HOLD_LABELS: Record<string, string> = {
  ghl_dnd: 'Do-not-disturb in GHL',
  multi_property: 'Rows disagree on which property',
  ambiguous_contact: 'Two CRM contacts share this address',
  contact_archived: 'Contact archived',
  contact_do_not_call: 'Marked do-not-call',
  opted_out: 'Opted out of email',
  previously_bounced: 'Bounced before',
  identity_suspect: 'Address may not be theirs',
  catch_all_unscored: 'Catch-all domain, unscored',
  campaigned_recently: 'Already emailed recently',
  business_domain_review: 'Business domain — needs a look',
  insert_conflict: 'Could not create the contact',
}

export function holdLabel(reason: string): string {
  if (HOLD_LABELS[reason]) return HOLD_LABELS[reason]
  if (reason.startsWith('said_no:')) return `Already said no (${reason.slice(8)})`
  if (reason.startsWith('address_shared_by_')) return 'Address shared by several people'
  if (reason.startsWith('undeliverable:')) return `Undeliverable (${reason.split(':')[1]})`
  return reason
}
