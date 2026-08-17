import { useMutation, useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
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

export type OutreachAudienceRequest = {
  lists: string[]
  audience: string
  never_answered: boolean
  recent_days: number
  limit?: number
}

/**
 * Build an email audience from the spine. A straight RPC -- there is nothing to fetch from a
 * third party any more, the list IS a Supabase query. Always a dry run from the page; the
 * committing run (which stamps last_campaigned_at) happens at export time.
 */
export function useOutreachAudiencePreview() {
  return useMutation({
    mutationFn: async (req: OutreachAudienceRequest): Promise<AudiencePreview> => {
      const { data, error } = await supabase.rpc('outreach_audience', {
        p: { ...req, dry_run: true, limit: req.limit ?? 5000 },
      })
      if (error) throw error
      return data as unknown as AudiencePreview
    },
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

/** Plain-English labels for the hold reasons outreach_audience emits. */
export const HOLD_LABELS: Record<string, string> = {
  wrong_person: 'Confirmed wrong person',
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
  already_replied: 'Already replied — not a re-mail target',
}

export function holdLabel(reason: string): string {
  if (HOLD_LABELS[reason]) return HOLD_LABELS[reason]
  if (reason.startsWith('said_no:')) return `Already said no (${reason.slice(8)})`
  if (reason.startsWith('address_shared_by_')) return 'Address shared by several people'
  if (reason.startsWith('undeliverable:')) return `Undeliverable (${reason.split(':')[1]})`
  return reason
}

