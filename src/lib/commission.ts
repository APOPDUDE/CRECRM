import type { Enums } from '@/lib/database.types'

export interface CommissionInput {
  dealType: Enums<'deal_type'>
  /** listings.commission_pct */
  commissionPct: number | null
  /** listings.co_broke_split_pct — the share given away to a co-broker. */
  coBrokeSplitPct: number | null
  /** property.building_sf — needed to gross up a lease rate. */
  buildingSf: number | null
  /** lease: executed $/SF/yr */
  executedRatePsf?: number | null
  /** sale: total executed price */
  executedPrice?: number | null
  /** lease term in months */
  termMonths?: number | null
}

export interface CommissionResult {
  /** Total lease consideration (gross rent over the term) or the sale price. */
  dealValue: number | null
  /** dealValue × commission%. */
  grossFee: number | null
  /** grossFee × co-broke split%. */
  coBrokeShare: number | null
  /** grossFee − coBrokeShare — what the broker keeps. */
  netFee: number | null
}

const EMPTY: CommissionResult = {
  dealValue: null,
  grossFee: null,
  coBrokeShare: null,
  netFee: null,
}

/**
 * Estimate the brokerage fee on an executed deal.
 * - lease: dealValue = rate $/SF/yr × building SF × (term months / 12) (gross rent over the term)
 * - sale:  dealValue = sale price
 * grossFee = dealValue × commission%, netFee = grossFee minus the co-broke split.
 * Returns nulls whenever a required input is missing so callers only prefill when computable.
 */
export function calculateCommission(input: CommissionInput): CommissionResult {
  const {
    dealType,
    commissionPct,
    coBrokeSplitPct,
    buildingSf,
    executedRatePsf,
    executedPrice,
    termMonths,
  } = input

  if (commissionPct == null) return EMPTY

  let dealValue: number | null = null
  if (dealType === 'sale') {
    dealValue = executedPrice ?? null
  } else if (
    executedRatePsf != null &&
    buildingSf != null &&
    termMonths != null &&
    termMonths > 0
  ) {
    dealValue = executedRatePsf * buildingSf * (termMonths / 12)
  }

  if (dealValue == null || !Number.isFinite(dealValue)) return EMPTY

  const grossFee = dealValue * (commissionPct / 100)
  const coBrokeShare = grossFee * ((coBrokeSplitPct ?? 0) / 100)
  const netFee = grossFee - coBrokeShare

  return { dealValue, grossFee, coBrokeShare, netFee }
}
