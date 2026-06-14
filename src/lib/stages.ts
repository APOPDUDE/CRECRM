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
  { value: 'lease_negotiation', label: 'Lease negotiation' },
  { value: 'executed', label: 'Executed' },
]

export const matchStageLabels: Record<Enums<'match_stage'>, string> = {
  inquiring: 'Inquiring',
  lead: 'Lead',
  toured: 'Toured',
  loi: 'LOI',
  lease_negotiation: 'Lease negotiation',
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
  dealType: 'lease' | 'sale',
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
  dealType: 'lease' | 'sale' = 'lease',
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
