import type { Enums } from '@/lib/database.types'
import { dorLabel } from '@/lib/dor-codes'

export type MarketEventType = Enums<'market_event_type'>
export type PropertyKind = Enums<'property_kind'>

/** Friendly category labels — probate rides the life_event type. */
export const EVENT_TYPE_LABELS: Record<MarketEventType, string> = {
  permit: 'Permit',
  sale: 'Sale',
  zoning_change: 'Zoning',
  code_enforcement: 'Code enforcement',
  foreclosure: 'Pre-foreclosure',
  life_event: 'Probate / life event',
  bankruptcy: 'Bankruptcy',
  tax_delinquent: 'Tax delinquent',
}

/** Distress signals first, routine activity last. */
export const EVENT_TYPE_ORDER: MarketEventType[] = [
  'foreclosure',
  'bankruptcy',
  'tax_delinquent',
  'code_enforcement',
  'life_event',
  'permit',
  'zoning_change',
  'sale',
]

/**
 * One colour per event type so the eye sorts a list without reading it:
 * reds/ambers = distress, blues/greens = activity.
 */
export const EVENT_TYPE_CHIP: Record<MarketEventType, string> = {
  foreclosure: 'border-red-200 bg-red-100 text-red-800',
  bankruptcy: 'border-purple-200 bg-purple-100 text-purple-800',
  tax_delinquent: 'border-amber-200 bg-amber-100 text-amber-800',
  code_enforcement: 'border-orange-200 bg-orange-100 text-orange-800',
  life_event: 'border-violet-200 bg-violet-100 text-violet-800',
  permit: 'border-sky-200 bg-sky-100 text-sky-800',
  zoning_change: 'border-teal-200 bg-teal-100 text-teal-800',
  sale: 'border-emerald-200 bg-emerald-100 text-emerald-800',
}

/** Use buckets for the filter — the CRM's property kind, plus "unknown" for unmatched rows. */
export type UseBucket = PropertyKind | 'unknown'
export const USE_ORDER: UseBucket[] = ['industrial', 'land', 'retail', 'office', 'other', 'unknown']
export const USE_LABELS: Record<UseBucket, string> = {
  industrial: 'Industrial',
  land: 'Land',
  retail: 'Retail',
  office: 'Office',
  other: 'Other',
  unknown: 'Unknown use',
}

export function kindBucket(kind: PropertyKind | null | undefined): UseBucket {
  return kind ?? 'unknown'
}

/**
 * Descriptive use tag for a row: the county's DOR class when we have it
 * ("Vacant industrial", "Warehouse / distribution"), else the CRM kind.
 */
export function usageTag(
  dorUseCode: string | null | undefined,
  kind: PropertyKind | null | undefined,
): string | null {
  return dorLabel(dorUseCode) ?? (kind ? USE_LABELS[kind] : null)
}
