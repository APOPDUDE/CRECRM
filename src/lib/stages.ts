import type { Enums } from '@/lib/database.types'

export interface StageDef<T extends string> {
  value: T
  label: string
}

/** Landlord Rep board columns — listings move proposal → listed → closed. */
export const listingStages: StageDef<Enums<'listing_stage'>>[] = [
  { value: 'proposal', label: 'Proposal' },
  { value: 'listed', label: 'Listed' },
  { value: 'closed', label: 'Closed' },
]

/** Tenant Rep board columns. */
export const tenantRepStages: StageDef<Enums<'tenant_rep_stage'>>[] = [
  { value: 'lead', label: 'Lead' },
  { value: 'touring', label: 'Touring' },
  { value: 'loi', label: 'LOI' },
  { value: 'lease_negotiation', label: 'Negotiation' },
  { value: 'executed', label: 'Executed' },
]

export const matchStageLabels: Record<Enums<'match_stage'>, string> = {
  inquiring: 'Inquiring',
  lead: 'Lead',
  toured: 'Toured',
  loi: 'LOI',
  lease_negotiation: 'Negotiation',
  executed: 'Executed',
  dead: 'Dead',
}

/** Sale-listing column relabels for the property board (same underlying enum). */
export const matchStageSaleLabels: Record<Enums<'match_stage'>, string> = {
  inquiring: 'Inquiring',
  lead: 'Lead',
  toured: 'Toured',
  loi: 'Offer',
  lease_negotiation: 'PSA negotiation',
  executed: 'PSA executed',
  dead: 'Dead',
}

/** Property-board columns: all five live match stages, labeled per deal type. */
export function propertyBoardStages(
  dealType: Enums<'deal_type'>,
): StageDef<Enums<'match_stage'>>[] {
  const labels = dealType === 'sale' ? matchStageSaleLabels : matchStageLabels
  return (['lead', 'toured', 'loi', 'lease_negotiation', 'executed'] as const).map((value) => ({
    value,
    label: labels[value],
  }))
}

/**
 * Tenant-board columns: Inquiring → Touring → LOI → Lease negotiation → Executed.
 * "Inquiring" holds search-/scrape-sourced prospects; "Touring" covers both lead
 * and toured matches. mapTenantBoardColumn collapses 'lead' into 'toured' so the
 * single match_stage enum stays the source of truth across both boards.
 */
export function tenantBoardStages(
  dealType: Enums<'deal_type'> = 'lease',
): StageDef<Enums<'match_stage'>>[] {
  const labels = dealType === 'sale' ? matchStageSaleLabels : matchStageLabels
  return [
    { value: 'inquiring', label: 'Inquiring' },
    { value: 'toured', label: 'Touring' },
    { value: 'loi', label: labels.loi },
    { value: 'lease_negotiation', label: labels.lease_negotiation },
    { value: 'executed', label: labels.executed },
  ]
}

export function mapTenantBoardColumn(stage: Enums<'match_stage'>): Enums<'match_stage'> {
  return stage === 'lead' ? 'toured' : stage
}

/** Rank used to pick the "hottest" (furthest-along) match on a listing. Dead is excluded. */
const matchStageRank: Record<Enums<'match_stage'>, number> = {
  inquiring: 0,
  lead: 1,
  toured: 2,
  loi: 3,
  lease_negotiation: 4,
  executed: 5,
  dead: -1,
}

/** Given a listing's matches, return the furthest-along live stage, or null if none. */
export function hottestStage(
  matches: { stage: Enums<'match_stage'> }[],
): Enums<'match_stage'> | null {
  let best: Enums<'match_stage'> | null = null
  for (const m of matches) {
    if (m.stage === 'dead') continue
    if (best === null || matchStageRank[m.stage] > matchStageRank[best]) {
      best = m.stage
    }
  }
  return best
}

/** Live (non-dead) matches. */
export function liveMatches<T extends { stage: Enums<'match_stage'> }>(matches: T[]): T[] {
  return matches.filter((m) => m.stage !== 'dead')
}

/**
 * Repping overview (level-1) board. Both sides collapse to a synthetic 3-bucket
 * pipeline — Lead / Searching / Closed — so the landlord and tenant overviews share
 * one board. The detail/match boards keep their full 5-stage enums; these buckets
 * are only for the overview and map back to the real enum on drop.
 */
export type ReppingBucket = 'lead' | 'searching' | 'closed'

export const reppingOverviewStages: StageDef<ReppingBucket>[] = [
  { value: 'lead', label: 'Lead' },
  { value: 'searching', label: 'Searching' },
  { value: 'closed', label: 'Closed' },
]

/** Listing stage → overview bucket. proposal → lead, listed → searching, closed → closed. */
export function listingStageToBucket(stage: Enums<'listing_stage'>): ReppingBucket {
  if (stage === 'proposal') return 'lead'
  if (stage === 'closed') return 'closed'
  return 'searching' // 'listed'
}

/** Overview bucket → listing stage to persist on drop. */
export function bucketToListingStage(bucket: ReppingBucket): Enums<'listing_stage'> {
  if (bucket === 'lead') return 'proposal'
  if (bucket === 'closed') return 'closed'
  return 'listed'
}

/** Tenant-rep stage → overview bucket. lead → lead, executed → closed, everything mid → searching. */
export function tenantRepStageToBucket(stage: Enums<'tenant_rep_stage'>): ReppingBucket {
  if (stage === 'lead') return 'lead'
  if (stage === 'executed') return 'closed'
  return 'searching' // touring | loi | lease_negotiation
}

/** Overview bucket → tenant-rep stage to persist on drop. searching → touring (first searching stage). */
export function bucketToTenantRepStage(bucket: ReppingBucket): Enums<'tenant_rep_stage'> {
  if (bucket === 'lead') return 'lead'
  if (bucket === 'closed') return 'executed'
  return 'touring'
}
