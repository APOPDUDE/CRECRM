import type { Enums, Tables } from '@/lib/database.types'
import { compactUsd, formatSf } from '@/lib/format'

export type DealRadarRow = Tables<'deal_radar'>
export type DealRadarStatus = Enums<'deal_radar_status'>
export type DealRadarType = Enums<'deal_radar_type'>

/**
 * The AXIS-voice outreach template. Merge fields resolve from the listing row;
 * a missing field drops its whole clause so the text never reads "for  in ".
 * Edit the copy here — it is the single source for what gets pasted.
 */
export const DEFAULT_MESSAGE_TEMPLATE =
  "Hi - saw your listing{{addressClause}}{{priceClause}}. I work with industrial and land buyers in {{market}} and may have a fit.{{sizeClause}} Is it still available, and is that the current number? Can move fast if it pencils. - Alex, AXIS"

/** Build the merge values, pre-composing the optional clauses. */
function mergeValues(row: DealRadarRow): Record<string, string> {
  const price = compactUsd(row.price)
  const size =
    formatSf(row.size_sqft) ?? (row.size_acres != null ? `${row.size_acres} acres` : null)
  return {
    market: row.market,
    addressClause: row.location_text ? ` in ${row.location_text}` : '',
    priceClause: price ? ` at ${price}` : '',
    sizeClause: size ? ` I have buyers looking around ${size}.` : '',
  }
}

/** Render the template for one listing. Unknown tokens resolve to empty. */
export function renderMessage(row: DealRadarRow, template = DEFAULT_MESSAGE_TEMPLATE): string {
  const values = mergeValues(row)
  return template
    .replace(/\{\{\s*([\w]+)\s*\}\}/g, (_m, key: string) => values[key] ?? '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export const typeLabels: Record<DealRadarType, string> = {
  industrial: 'Industrial',
  land: 'Land',
}

export const typeBadgeClass: Record<DealRadarType, string> = {
  industrial: 'bg-orange-50 text-orange-700 border-orange-200',
  land: 'bg-lime-50 text-lime-700 border-lime-200',
}

// The human triages each listing to one of two buckets — approved (pursuing it) or
// declined (passed). 'converted' marks an approved listing turned into a real CRM
// deal. The worker only ever writes 'new'. messaged/replied/negotiating/dead are
// legacy states migrated into the new model; kept here for type-completeness.
export const statusLabels: Record<DealRadarStatus, string> = {
  new: 'New',
  approved: 'Approved',
  declined: 'Declined',
  converted: 'Deal created',
  messaged: 'Approved',
  replied: 'Approved',
  negotiating: 'Approved',
  dead: 'Declined',
}

export const statusBadgeClass: Record<DealRadarStatus, string> = {
  new: 'bg-blue-50 text-blue-700 border-blue-200',
  approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  declined: 'bg-gray-100 text-gray-500 border-gray-200',
  converted: 'bg-teal-50 text-teal-700 border-teal-200',
  messaged: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  replied: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  negotiating: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  dead: 'bg-gray-100 text-gray-500 border-gray-200',
}

/** The moves the manual status picker offers. converted is set by Create deal. */
export const STATUS_ORDER: DealRadarStatus[] = ['new', 'approved', 'declined']

/** The Approved bucket holds greenlit listings plus those already turned into deals. */
export const APPROVED_STATUSES: DealRadarStatus[] = ['approved', 'converted']

// Sale vs lease, read off the listing title/price by the worker's DB trigger.
// 'unknown' shows a "?" for the human to categorize.
export type DealRadarIntent = Enums<'deal_radar_intent'>

export const intentLabels: Record<DealRadarIntent, string> = {
  sale: 'For sale',
  lease: 'For lease',
  unknown: '?',
}

export const intentBadgeClass: Record<DealRadarIntent, string> = {
  sale: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  lease: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  unknown: 'bg-gray-100 text-gray-500 border-gray-200',
}

/** The order the intent picker offers moves in. */
export const INTENT_ORDER: DealRadarIntent[] = ['sale', 'lease', 'unknown']

/** Rate for a lease vs total for a sale is ambiguous on Marketplace — show it raw. */
export function formatRadarPrice(row: DealRadarRow): string | null {
  return compactUsd(row.price)
}

/** "5,000 SF" or "2.5 acres" or both, whichever the parse produced. */
export function formatRadarSize(row: DealRadarRow): string | null {
  const parts = [formatSf(row.size_sqft), row.size_acres != null ? `${row.size_acres} acres` : null]
  return parts.filter(Boolean).join(' · ') || null
}

/** A worker cycle older than 3h means the Mac probably isn't polling — flag it. */
export function isRunStale(startedAt: string | null | undefined): boolean {
  if (!startedAt) return false
  return new Date().getTime() - new Date(startedAt).getTime() > 3 * 60 * 60_000
}
