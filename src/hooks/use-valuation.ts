import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

/**
 * The property value estimate — a comp-driven "what would this trade for, rent
 * for, and cost in taxes". The whole calculation lives in Postgres
 * (`estimate_property_value`), so n8n and the phone Claude get the same number
 * this page shows; these hooks only fetch and render it.
 */

export type ValuationBucket = 'lease' | 'sale' | 'land'

export interface ValuationComp {
  comp_id: string
  property_id: string
  address: string | null
  city: string | null
  county: string | null
  property_type: string | null
  building_class: 'A' | 'B' | 'C' | null
  bucket: ValuationBucket
  kind: 'asking' | 'executed'
  verified: boolean | null
  tenant_name: string | null
  lease_structure: string | null
  term_months: number | null
  opex_psf: number | null
  cap_rate_pct: number | null
  sale_price: number | null
  comp_date: string | null
  sf: number | null
  acres: number | null
  miles: number | null
  /** The comp's own rate: $/SF for lease & sale, $/acre for land. */
  metric: number | null
  /** After size + class, before the asking haircut. */
  adj_pre: number | null
  /** The number that actually feeds the estimate: size, class and haircut applied. */
  adj_metric: number | null
  size_adj: number | null
  class_adj: number | null
  /** Haircut turning an asking price into an expected trade price. 0 on executed. */
  discount_pct: number | null
  weight: number | null
  /** Share of the estimate this comp carries, 0 when struck. */
  weight_pct: number | null
  included: boolean
}

interface BucketStats {
  n: number
  n_executed: number
  avg_miles: number | null
  avg_asking_discount: number | null
  n_class_adjusted: number | null
  confidence: 'high' | 'medium' | 'low'
}

/** The tunables that produced this estimate, echoed back so the panel can show them. */
export interface ValuationMethod {
  asking_discount_pct: number
  asking_overprice_k: number
  weight_asking: number
  weight_executed: number
  /** False = no A/B/C ladder could be measured for this type, so defaults were used. */
  class_ladder_measured: boolean
  class_factors: Record<string, number>
}

export interface LeaseEstimate extends BucketStats {
  psf: number
  psf_low: number | null
  psf_high: number | null
  monthly: number | null
  monthly_low: number | null
  monthly_high: number | null
  annual: number | null
}

export interface SaleEstimate extends BucketStats {
  psf: number
  psf_low: number | null
  psf_high: number | null
  total: number | null
  total_low: number | null
  total_high: number | null
  cap_rate: number | null
}

export interface LandEstimate extends BucketStats {
  per_acre: number
  per_acre_low: number | null
  per_acre_high: number | null
  total: number | null
  total_low: number | null
  total_high: number | null
}

export interface TaxEstimate {
  county: string | null
  millage: number
  rate_pct: number
  source: string
  effective_year: number | null
  notes: string | null
  /** The value the tax is figured on — our sale (or land) estimate. */
  basis: number | null
  assessed_value: number | null
  /** What today's assessed value would bill at this millage. */
  current_annual: number | null
}

export interface PropertyValuation {
  property_id: string
  as_of: string
  subject: {
    address: string | null
    county: string | null
    property_type: string | null
    building_class: 'A' | 'B' | 'C' | null
    sf: number | null
    land_acres: number | null
    year_built: number | null
    just_value: number | null
    assessed_value: number | null
  }
  method: ValuationMethod
  sale: SaleEstimate | null
  lease: LeaseEstimate | null
  land: LandEstimate | null
  tax: TaxEstimate | null
  comps: ValuationComp[]
  excluded_comp_ids: string[]
}

/** Annual tax off the estimate, or off today's assessed value when we can't value it. */
export function estimatedAnnualTax(tax: TaxEstimate | null | undefined): number | null {
  if (!tax) return null
  if (tax.basis != null) return Math.round((tax.basis * tax.millage) / 1000)
  return tax.current_annual
}

export function usePropertyValuation(propertyId: string | null | undefined) {
  return useQuery({
    queryKey: ['property-valuation', propertyId],
    enabled: !!propertyId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<PropertyValuation | null> => {
      const { data, error } = await supabase.rpc('estimate_property_value', {
        p_property_id: propertyId!,
      })
      if (error) throw error
      return (data as unknown as PropertyValuation) ?? null
    },
  })
}

/**
 * Strike a comp from (or restore it to) one property's estimate. The exclusion
 * is stored, not held in component state — "that one doesn't fit my building"
 * is a judgement the CRM has to still know next week.
 */
export function useToggleValuationComp() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      propertyId,
      compId,
      include,
    }: {
      propertyId: string
      compId: string
      include: boolean
    }) => {
      if (include) {
        const { error } = await supabase
          .from('valuation_comp_exclusions')
          .delete()
          .eq('property_id', propertyId)
          .eq('comp_id', compId)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('valuation_comp_exclusions')
          .upsert({ property_id: propertyId, comp_id: compId }, { onConflict: 'property_id,comp_id' })
        if (error) throw error
      }
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['property-valuation', vars.propertyId] })
    },
  })
}

/** Restore every struck comp on a property. */
export function useResetValuationComps() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (propertyId: string) => {
      const { error } = await supabase
        .from('valuation_comp_exclusions')
        .delete()
        .eq('property_id', propertyId)
      if (error) throw error
    },
    onSuccess: (_d, propertyId) => {
      qc.invalidateQueries({ queryKey: ['property-valuation', propertyId] })
    },
  })
}

/**
 * Correct a county's millage. The seeded rates are approximations of the
 * aggregate rate; the broker holding a real tax bill should be able to fix it
 * once and have every property in that county follow.
 */
export function useSetCountyMillage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      county,
      state,
      millage,
    }: {
      county: string
      state: string | null
      millage: number
    }) => {
      const { error } = await supabase.from('county_tax_rates').upsert(
        {
          county,
          state: state ?? 'FL',
          millage,
          source: 'broker',
          notes: 'Set by hand from the tax bill',
        },
        { onConflict: 'county,state' },
      )
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['property-valuation'] })
    },
  })
}
