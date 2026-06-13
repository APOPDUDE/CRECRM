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
  lead: 'Lead',
  toured: 'Toured',
  loi: 'LOI',
  lease_negotiation: 'Lease negotiation',
  executed: 'Executed',
  dead: 'Dead',
}

/** Rank used to pick the "hottest" (furthest-along) match on a listing. Dead is excluded. */
const matchStageRank: Record<Enums<'match_stage'>, number> = {
  lead: 0,
  toured: 1,
  loi: 2,
  lease_negotiation: 3,
  executed: 4,
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
