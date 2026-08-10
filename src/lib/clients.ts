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

export const industrialSubclassLabels: Record<Enums<'industrial_subclass'>, string> = {
  ios: 'IOS / yard',
  small_bay: 'Small bay',
  big_box: 'Big box',
  cold_storage: 'Cold storage',
  flex: 'Flex',
  land_development: 'Land / development',
}

export const investmentStrategyLabels: Record<Enums<'investment_strategy'>, string> = {
  stnl: 'STNL',
  value_add: 'Value add',
  core_stabilized: 'Core / stabilized',
  development: 'Development',
  sale_leaseback: 'Sale leaseback',
  covered_land: 'Covered land',
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
