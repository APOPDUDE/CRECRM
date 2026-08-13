import type { Enums, Tables } from '@/lib/database.types'
import type { LatLng } from '@/lib/geo'
import { pointInPolygon } from '@/lib/geo'

/**
 * One `clients` table feeds two pipelines. Which side a client shows on is its deal_type:
 * 'both' genuinely runs both, the same way boardSides() runs two boards for it.
 * is_rep=false is a landlord-side prospect — those live on the landlord board only.
 */
type ClientSides = Pick<Tables<'clients'>, 'is_rep' | 'deal_type'>

export function isTenantClient(c: ClientSides): boolean {
  return c.is_rep && c.deal_type !== 'sale'
}

export function isBuyerClient(c: ClientSides): boolean {
  return c.is_rep && c.deal_type !== 'lease'
}

/**
 * Off the roster because the search ended — the owner-user bought, the 1031 clock ran out.
 * Distinct from lost (someone else got them) and closed (there was a deal). Archived clients
 * are excluded from every list, count, blast and match; the Archived filter is where they live.
 */
export function isArchivedClient(c: Pick<Tables<'clients'>, 'status'>): boolean {
  return c.status === 'archived'
}

/** Size rule, mirrored in the industrial_subclass comment: small bay is under 10k SF. */
export const industrialSubclassLabels: Record<Enums<'industrial_subclass'>, string> = {
  ios: 'IOS / yard',
  small_bay: 'Small bay',
  big_box: 'Big box',
  cold_storage: 'Cold storage',
  self_storage: 'Self storage',
  flex: 'Flex',
  land_development: 'Land / development',
}

/**
 * How a subclass reads inside a sentence: "you're after IOS around Seminole".
 * The display labels don't survive lowercasing — IOS is an acronym, not a word.
 */
export const industrialSubclassPhrases: Record<Enums<'industrial_subclass'>, string> = {
  ios: 'IOS',
  small_bay: 'small bay',
  big_box: 'big box',
  cold_storage: 'cold storage',
  self_storage: 'self storage',
  flex: 'flex',
  land_development: 'land',
}

export const industrialSubclassHints: Partial<Record<Enums<'industrial_subclass'>, string>> = {
  small_bay: 'Under 10,000 SF',
  big_box: '10,000 SF and up',
  // Three subclasses have "storage" in the sense a broker might say it; this one means the
  // facility itself, not a cold warehouse and not yard space.
  self_storage: 'The facility, not yard or cold',
}

export const investmentStrategyLabels: Record<Enums<'investment_strategy'>, string> = {
  value_add: 'Value add',
  core_stabilized: 'Core / stabilized',
  development: 'Development',
  sale_leaseback: 'Sale leaseback',
  covered_land: 'Covered land',
  // Wants to own a building, doesn't know CRE. Changes how the deal gets explained.
  schmuck: 'Schmuck',
}

export const buyerKindLabels: Record<Enums<'buyer_kind'>, string> = {
  investor: 'Investor',
  owner_user: 'Owner-user',
  developer: 'Developer',
}

export const industrialSubclasses = Object.keys(
  industrialSubclassLabels,
) as Enums<'industrial_subclass'>[]

export const investmentStrategies = Object.keys(
  investmentStrategyLabels,
) as Enums<'investment_strategy'>[]

export const buyerKinds = Object.keys(buyerKindLabels) as Enums<'buyer_kind'>[]

/**
 * A named area a buyer will buy in, drawn on a map. Stored on clients.target_areas as
 * jsonb; the ring is [lat, lng] pairs in draw order with the closing edge implicit —
 * the same convention public.point_in_ring() reads server-side, so a browser answer and
 * an automation answer can never disagree.
 */
export type TargetArea = { name: string; ring: [number, number][] }

export function parseTargetAreas(value: unknown): TargetArea[] {
  if (!Array.isArray(value)) return []
  const out: TargetArea[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const { name, ring } = raw as { name?: unknown; ring?: unknown }
    if (!Array.isArray(ring) || ring.length < 3) continue
    const points: [number, number][] = []
    for (const p of ring) {
      if (!Array.isArray(p) || p.length < 2) continue
      const lat = Number(p[0])
      const lng = Number(p[1])
      if (Number.isFinite(lat) && Number.isFinite(lng)) points.push([lat, lng])
    }
    if (points.length >= 3) out.push({ name: typeof name === 'string' ? name : 'Area', ring: points })
  }
  return out
}

const toLatLngs = (ring: [number, number][]): LatLng[] =>
  ring.map(([lat, lng]) => ({ lat, lng }))

/** Does any of the buyer's drawn areas contain this point? No areas drawn = unknown, not everywhere. */
export function areasCoverPoint(
  areas: TargetArea[],
  lat: number | null | undefined,
  lng: number | null | undefined,
): boolean {
  return areas.some((a) => pointInPolygon(toLatLngs(a.ring), lat, lng))
}

/** Whole days until a 1031 exchange deadline; negative once it has passed. */
export function daysUntil(date: string | null | undefined): number | null {
  if (!date) return null
  const then = new Date(`${date}T00:00:00`)
  if (Number.isNaN(then.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((then.getTime() - today.getTime()) / 86_400_000)
}
