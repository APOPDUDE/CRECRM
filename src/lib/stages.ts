import type { Enums } from '@/lib/database.types'

export interface StageDef<T extends string> {
  value: T
  label: string
}

/** Landlord Rep board columns — listings move proposal -> listed -> closed. */
export const listingStages: StageDef<Enums<'listing_stage'>>[] = [
  { value: 'proposal', label: 'Proposal' },
  { value: 'listed', label: 'Listed' },
  { value: 'closed', label: 'Closed' },
]

export const listingStageLabels: Record<Enums<'listing_stage'>, string> = {
  proposal: 'Proposal',
  listed: 'Listed',
  closed: 'Closed',
}

/** Client lifecycle (the level-1 tenant overview columns). 'lost' is a status, not a column. */
export const clientStatusLabels: Record<Enums<'client_status'>, string> = {
  prospect: 'Prospect',
  searching: 'Searching',
  negotiating: 'Negotiating',
  closed: 'Closed',
  lost: 'Lost',
}

/** Tenant overview board columns: the live client statuses ('lost' is filtered out). */
export const clientOverviewStages: StageDef<Enums<'client_status'>>[] = [
  { value: 'prospect', label: 'Prospect' },
  { value: 'searching', label: 'Searching' },
  { value: 'negotiating', label: 'Negotiating' },
  { value: 'closed', label: 'Closed' },
]

/** Pursuit pipeline labels (lease). */
export const pursuitStageLabels: Record<Enums<'pursuit_stage'>, string> = {
  inquiring: 'Inquiring',
  touring: 'Touring',
  negotiation: 'Negotiation',
  executed: 'Executed',
  passed: 'Passed',
}

/** Sale relabels for the pipeline (same underlying enum). */
export const pursuitStageSaleLabels: Record<Enums<'pursuit_stage'>, string> = {
  inquiring: 'Inquiring',
  touring: 'Touring',
  negotiation: 'PSA negotiation',
  executed: 'PSA executed',
  passed: 'Passed',
}

/** Pipeline columns shown on both the property board and the tenant board ('passed' is hidden). */
export function pursuitBoardStages(
  dealType: Enums<'deal_type'> = 'lease',
): StageDef<Enums<'pursuit_stage'>>[] {
  const labels = dealType === 'sale' ? pursuitStageSaleLabels : pursuitStageLabels
  return (['inquiring', 'touring', 'negotiation', 'executed'] as const).map((value) => ({
    value,
    label: labels[value],
  }))
}

/** Landlord-side property board columns. */
export const propertyBoardStages = pursuitBoardStages
/** Tenant-side board columns (identical pipeline, one source of truth across both boards). */
export const tenantBoardStages = pursuitBoardStages

/** Rank used to pick the "hottest" (furthest-along) pursuit on a property. 'passed' is excluded. */
const pursuitStageRank: Record<Enums<'pursuit_stage'>, number> = {
  inquiring: 0,
  touring: 1,
  negotiation: 2,
  executed: 3,
  passed: -1,
}

/** Given pursuits, return the furthest-along live stage, or null if none. */
export function hottestStage(
  pursuits: { stage: Enums<'pursuit_stage'> }[],
): Enums<'pursuit_stage'> | null {
  let best: Enums<'pursuit_stage'> | null = null
  for (const p of pursuits) {
    if (p.stage === 'passed') continue
    if (best === null || pursuitStageRank[p.stage] > pursuitStageRank[best]) {
      best = p.stage
    }
  }
  return best
}

/** Live (non-passed) pursuits. */
export function livePursuits<T extends { stage: Enums<'pursuit_stage'> }>(pursuits: T[]): T[] {
  return pursuits.filter((p) => p.stage !== 'passed')
}
