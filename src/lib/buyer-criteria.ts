import type { TargetArea } from '@/lib/clients'
import type { Enums } from '@/lib/database.types'
import { numOrNull } from '@/lib/format'

export type BuyerCriteria = {
  buyer_kind: Enums<'buyer_kind'> | null
  product_subclasses: Enums<'industrial_subclass'>[]
  strategies: Enums<'investment_strategy'>[]
  price_min: string
  price_max: string
  exchange_1031: boolean
  exchange_deadline: string
  target_areas: TargetArea[]
}

export const emptyBuyerCriteria = (): BuyerCriteria => ({
  buyer_kind: null,
  product_subclasses: [],
  strategies: [],
  price_min: '',
  price_max: '',
  exchange_1031: false,
  exchange_deadline: '',
  target_areas: [],
})

const num = (v: string) => numOrNull(v)

export function buyerCriteriaToRow(c: BuyerCriteria) {
  return {
    buyer_kind: c.buyer_kind,
    product_subclasses: c.product_subclasses,
    strategies: c.strategies,
    price_min: num(c.price_min),
    price_max: num(c.price_max),
    exchange_1031: c.exchange_1031,
    exchange_deadline: c.exchange_1031 ? c.exchange_deadline || null : null,
    target_areas: c.target_areas as unknown as never,
  }
}
