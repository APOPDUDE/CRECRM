import { format } from 'date-fns'
import type { Tables } from '@/lib/database.types'

type ProspectLike = Pick<Tables<'prospects'>, 'sourced_by' | 'description' | 'details'> & { lead_type?: string | null }

const CHANNEL_LABEL: Record<string, string> = {
  ig: 'Instagram',
  instagram: 'Instagram',
  yt: 'YouTube',
  youtube: 'YouTube',
  tt: 'TikTok',
  tiktok: 'TikTok',
  li: 'LinkedIn',
  linkedin: 'LinkedIn',
  fb: 'Facebook',
  facebook: 'Facebook',
  x: 'X',
  twitter: 'X',
  google: 'Google',
}

function detailsOf(p: ProspectLike): Record<string, unknown> {
  const d = p.details
  return d && typeof d === 'object' && !Array.isArray(d) ? (d as Record<string, unknown>) : {}
}

/**
 * Where a lead came from, for the badge on the Leads page. Website leads (alexpoplawski.com,
 * n8n workflow mj3kCPCgScjYx91f) carry the UTM channel they clicked through from; older
 * sources are read off the description prefix the intake wrote.
 */
export function leadSourceOf(p: ProspectLike): { label: string; className: string } | null {
  const d = detailsOf(p)
  if (p.sourced_by === 'website' || d.website === true) {
    // `channel` is the normalized platform (utm_source, else the referrer host); utm_source is the raw fallback.
    const raw = typeof d.channel === 'string' ? d.channel : typeof d.utm_source === 'string' ? d.utm_source : ''
    const via = raw ? ` · ${CHANNEL_LABEL[raw.toLowerCase()] ?? raw}` : ''
    return { label: `Website${via}`, className: 'border-blue-200 bg-blue-50 text-blue-700' }
  }
  const first = (p.description ?? '').split('\n')[0] ?? ''
  if (/^\[GHL lead/i.test(first)) return { label: 'GHL', className: 'border-violet-200 bg-violet-50 text-violet-700' }
  if (/facebook|deal radar/i.test(first)) return { label: 'Facebook', className: 'border-sky-200 bg-sky-50 text-sky-700' }
  if (p.sourced_by === 'va') return { label: 'VA', className: 'border-amber-200 bg-amber-50 text-amber-700' }
  return null
}

/** Consultation ($100, paid) vs User (free space inquiry) vs Seller - the badge Alex reads first. */
export function leadKindOf(p: ProspectLike & { lead_type?: string | null }): { label: string; className: string } | null {
  const d = detailsOf(p)
  if (d.form === 'consultation' || d.consult === true) return { label: 'Consultation', className: 'border-amber-300 bg-amber-50 text-amber-800' }
  if (p.lead_type === 'seller') return { label: 'Seller', className: 'border-rose-200 bg-rose-50 text-rose-700' }
  if (p.sourced_by === 'website' || d.website === true || p.lead_type === 'user') return { label: 'User', className: 'border-slate-300 bg-white text-slate-700' }
  return null
}

/**
 * Outreach and replies on a lead, stamped by the mark_lead_contact_activity trigger as rows land in
 * communications: confirmation email/text sent (by n8n as Frances), replies by text or email.
 */
export function activityOf(p: ProspectLike): { label: string; className: string; key: string }[] {
  const d = detailsOf(p)
  const when = (v: unknown) => {
    if (typeof v !== 'string') return null
    const t = new Date(v)
    return Number.isNaN(t.getTime()) ? null : format(t, 'MMM d')
  }
  const out: { label: string; className: string; key: string }[] = []
  const emailed = when(d.last_emailed_at)
  const texted = when(d.last_texted_at)
  const rEmail = when(d.replied_email_at)
  const rText = when(d.replied_text_at)
  if (rText) out.push({ key: 'rtext', label: `Replied by text ${rText}`, className: 'border-emerald-200 bg-emerald-50 text-emerald-700' })
  if (rEmail) out.push({ key: 'remail', label: `Replied by email ${rEmail}`, className: 'border-emerald-200 bg-emerald-50 text-emerald-700' })
  if (texted && !rText) out.push({ key: 'texted', label: `Texted ${texted}`, className: 'border-slate-200 bg-slate-50 text-slate-600' })
  if (emailed && !rEmail) out.push({ key: 'emailed', label: `Emailed ${emailed}`, className: 'border-slate-200 bg-slate-50 text-slate-600' })
  return out
}

/** "Called Sep 4" - stamped by the mark_lead_contact_activity trigger when a GHL call lands in communications. */
export function calledOf(p: ProspectLike): { label: string; calls: number; last: Date } | null {
  const d = detailsOf(p)
  if (typeof d.last_called_at !== 'string') return null
  const last = new Date(d.last_called_at)
  if (Number.isNaN(last.getTime())) return null
  const calls = typeof d.calls === 'number' ? d.calls : 1
  return { last, calls, label: `Called ${format(last, 'MMM d')}${calls > 1 ? ` ×${calls}` : ''}` }
}

/** The Calendly booking intake_calendly_booking stamped on a lead, if any. */
export function calendlyBookingOf(
  p: ProspectLike,
): { start: Date; label: string; canceled: boolean; taskId: string | null } | null {
  const c = detailsOf(p).calendly
  if (!c || typeof c !== 'object') return null
  const cal = c as Record<string, unknown>
  if (typeof cal.start_time !== 'string') return null
  const start = new Date(cal.start_time)
  if (Number.isNaN(start.getTime())) return null
  const canceled = cal.status === 'canceled'
  return {
    start,
    canceled,
    label: `${canceled ? 'Canceled' : 'Booked'} ${format(start, 'EEE MMM d · h:mm a')}`,
    taskId: typeof cal.task_id === 'string' ? cal.task_id : null,
  }
}

/**
 * The three things a meeting can be, coloured the same way everywhere: on the board card
 * and as the block in calendar view. The type comes off the Calendly event name in
 * `v_lead_board`, so it is never typed by hand.
 */
export const MEETING_TYPE_META: Record<string, { label: string; className: string; dot: string }> = {
  space: {
    label: 'Space',
    className: 'border-slate-300 bg-slate-50 text-slate-700',
    dot: 'bg-slate-400',
  },
  software: {
    label: 'Software',
    className: 'border-indigo-200 bg-indigo-50 text-indigo-700',
    dot: 'bg-indigo-500',
  },
  // Both paid calls are named "Consultation" in Calendly, so the board splits them by
  // duration: 30 minutes is the $100, an hour is the $250.
  consult_100: {
    label: '$100 · 30m',
    className: 'border-amber-300 bg-amber-50 text-amber-800',
    dot: 'bg-amber-500',
  },
  consult_250: {
    label: '$250 · 1h',
    className: 'border-emerald-300 bg-emerald-50 text-emerald-800',
    dot: 'bg-emerald-500',
  },
  // Retired chip, kept so rows booked before 2026-09-21 still render.
  consultation: {
    label: 'Consultation',
    className: 'border-amber-300 bg-amber-50 text-amber-800',
    dot: 'bg-amber-500',
  },
}

export function meetingTypeMeta(type: string | null | undefined) {
  return type ? (MEETING_TYPE_META[type] ?? null) : null
}

/** Cold / warm / hot, shown as the card's left edge so the Met column reads as three bands. */
export const TEMPERATURE_META = {
  hot: { label: 'Hot', edge: 'border-l-red-500', chip: 'bg-red-500', rank: 0 },
  warm: { label: 'Warm', edge: 'border-l-amber-400', chip: 'bg-amber-400', rank: 1 },
  cold: { label: 'Cold', edge: 'border-l-sky-300', chip: 'bg-sky-300', rank: 2 },
} as const

export type Temperature = keyof typeof TEMPERATURE_META

export function temperatureRank(t: string | null | undefined): number {
  return t && t in TEMPERATURE_META ? TEMPERATURE_META[t as Temperature].rank : 3
}
