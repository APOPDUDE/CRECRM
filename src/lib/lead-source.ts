import { format } from 'date-fns'
import type { Tables } from '@/lib/database.types'

type ProspectLike = Pick<Tables<'prospects'>, 'sourced_by' | 'description' | 'details'>

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

/** "Called Sep 4" - stamped by the mark_lead_called trigger when a GHL call lands in communications. */
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
