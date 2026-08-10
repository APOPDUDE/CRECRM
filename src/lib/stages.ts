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

/**
 * Tenant overview board columns — only ELECTED tenant reps (clients with is_rep=true).
 * Landlord-side prospects (is_rep=false) never appear here; they live on the listing board.
 * 'lost' is a status, not a column.
 */
export const clientOverviewStages: StageDef<Enums<'client_status'>>[] = [
  { value: 'prospect', label: 'Prospect' },
  { value: 'searching', label: 'Searching' },
  { value: 'negotiating', label: 'Negotiating' },
  { value: 'closed', label: 'Closed' },
]

/** Pursuit pipeline labels (lease). due_diligence is a sale-only column; the lease
 * label exists only so every Record over the enum stays exhaustive. */
export const pursuitStageLabels: Record<Enums<'pursuit_stage'>, string> = {
  inquiring: 'Inquiring',
  confirmed: 'Confirmed',
  // Label only — the enum value is still `touring`, so every stamped tour_date, tour task
  // and stage rank keeps working. The column says when the tour is BOOKED; whether they
  // liked the place is the next column's job.
  touring: 'Scheduled',
  interested: 'Interested',
  negotiation: 'Negotiation',
  due_diligence: 'Due diligence',
  executed: 'Executed',
  passed: 'Passed',
}

/** Sale relabels for the pipeline (same underlying enum). The terminal stage stays
 * the 'executed' enum value — labeled Closed — so the execute machinery (fee, comp,
 * payment ladder, checklist) is shared with leases. */
export const pursuitStageSaleLabels: Record<Enums<'pursuit_stage'>, string> = {
  inquiring: 'Inquiring',
  confirmed: 'Confirmed',
  touring: 'Scheduled',
  interested: 'Interested',
  negotiation: 'PSA negotiation',
  due_diligence: 'Due diligence',
  executed: 'Closed',
  passed: 'Passed',
}

/** Deal-type-aware label map (sale boards read PSA negotiation / Due diligence / Closed). */
export function pursuitLabelsFor(
  dealType: Enums<'deal_type'> | null | undefined,
): Record<Enums<'pursuit_stage'>, string> {
  return dealType === 'sale' ? pursuitStageSaleLabels : pursuitStageLabels
}

/** Pipeline columns shown on both the property board and the tenant board ('passed' is
 * hidden). Sale pipelines get the extra due-diligence column between PSA negotiation
 * and Closed; lease pipelines never show it. */
export function pursuitBoardStages(
  dealType: Enums<'deal_type'> = 'lease',
): StageDef<Enums<'pursuit_stage'>>[] {
  const labels = pursuitLabelsFor(dealType)
  const order: Enums<'pursuit_stage'>[] =
    dealType === 'sale'
      ? ['inquiring', 'confirmed', 'touring', 'interested', 'negotiation', 'due_diligence', 'executed']
      : ['inquiring', 'confirmed', 'touring', 'interested', 'negotiation', 'executed']
  return order.map((value) => ({ value, label: labels[value] }))
}

/** Landlord-side property board columns. */
export const propertyBoardStages = pursuitBoardStages
/** Tenant-side board columns (identical pipeline, one source of truth across both boards). */
export const tenantBoardStages = pursuitBoardStages

/** One side of the flip board. A pursuit is always exactly one of these (DB check). */
export type DealSide = 'lease' | 'sale'

export const dealSideLabels: Record<DealSide, string> = {
  lease: 'For lease',
  sale: 'For sale',
}

/**
 * Which boards a client/listing runs. A parent set to 'both' gets two: its lease
 * pursuits and its sale pursuits move through different columns, so they can't share
 * one board. Pursuits are passed in as a safety net — if the parent was switched from
 * 'both' back to a single side, pursuits stranded on the other side keep their board
 * (and stay reachable) rather than silently vanishing.
 */
export function boardSides(
  dealType: Enums<'deal_type'> | null | undefined,
  pursuits: { deal_type: Enums<'deal_type'> }[] = [],
): DealSide[] {
  const sides = new Set<DealSide>()
  if (dealType === 'both') {
    sides.add('lease')
    sides.add('sale')
  } else {
    // 'lease', 'sale', or unset (unset reads as lease, same as the column labels)
    sides.add(dealType === 'sale' ? 'sale' : 'lease')
  }
  for (const p of pursuits) {
    if (p.deal_type === 'lease' || p.deal_type === 'sale') sides.add(p.deal_type)
  }
  // stable order — lease first, the way the deal-type select reads
  return (['lease', 'sale'] as const).filter((s) => sides.has(s))
}

/** Rank used to pick the "hottest" (furthest-along) pursuit on a property. 'passed' is excluded. */
const pursuitStageRank: Record<Enums<'pursuit_stage'>, number> = {
  inquiring: 0,
  confirmed: 1,
  touring: 2,
  interested: 3,
  negotiation: 4,
  due_diligence: 5,
  executed: 6,
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
