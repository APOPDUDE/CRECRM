import { Button } from '@/components/ui/button'
import { CurrencyInput } from '@/components/ui/currency-input'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { AreaDrawMap } from '@/components/area-draw-map'
import {
  buyerKindLabels,
  buyerKinds,
  industrialSubclassLabels,
  industrialSubclasses,
  investmentStrategies,
  investmentStrategyLabels,
} from '@/lib/clients'
import type { TargetArea } from '@/lib/clients'
import type { Enums } from '@/lib/database.types'
import { numOrNull } from '@/lib/format'
import { cn } from '@/lib/utils'

export const NO_KIND = '__none__'

/** A row of toggling chips — the multi-select shape used across the war room filters. */
export function ChipRow<T extends string>({
  values,
  labels,
  selected,
  onToggle,
  size = 'sm',
}: {
  values: T[]
  labels: Record<T, string>
  selected: T[]
  onToggle: (v: T) => void
  size?: 'sm' | 'xs'
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((v) => {
        const on = selected.includes(v)
        return (
          <Button
            key={v}
            type="button"
            variant={on ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => onToggle(v)}
            className={cn(
              'h-7 rounded-full px-3 text-xs font-normal',
              size === 'xs' && 'h-6 px-2.5',
              on && 'border-primary/40 font-medium',
            )}
          >
            {labels[v]}
          </Button>
        )
      })}
    </div>
  )
}

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

const toggle = <T,>(list: T[], v: T): T[] =>
  list.includes(v) ? list.filter((x) => x !== v) : [...list, v]

/**
 * The buyer half of a client record: what they buy, how they buy it, what they can
 * write a check for, and where. Shared by the Add buyer dialog and the client edit
 * dialog so a buyer's criteria are captured identically wherever you touch them.
 */
export function BuyerCriteriaFields({
  value,
  onChange,
  idPrefix = 'buyer',
  showAreas = true,
}: {
  value: BuyerCriteria
  onChange: (next: BuyerCriteria) => void
  idPrefix?: string
  /** Off where the parent form already renders one area map for every client. */
  showAreas?: boolean
}) {
  const patch = (p: Partial<BuyerCriteria>) => onChange({ ...value, ...p })

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-kind`}>Buyer type</Label>
        <Select
          value={value.buyer_kind ?? NO_KIND}
          onValueChange={(v) =>
            patch({ buyer_kind: v === NO_KIND ? null : (v as Enums<'buyer_kind'>) })
          }
        >
          <SelectTrigger id={`${idPrefix}-kind`} className="w-full">
            <SelectValue placeholder="Not set" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_KIND}>Not set</SelectItem>
            {buyerKinds.map((k) => (
              <SelectItem key={k} value={k}>
                {buyerKindLabels[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Product they buy</Label>
        <ChipRow
          values={industrialSubclasses}
          labels={industrialSubclassLabels}
          selected={value.product_subclasses}
          onToggle={(v) => patch({ product_subclasses: toggle(value.product_subclasses, v) })}
        />
      </div>

      <div className="space-y-2">
        <Label>Investment strategy</Label>
        <ChipRow
          values={investmentStrategies}
          labels={investmentStrategyLabels}
          selected={value.strategies}
          onToggle={(v) => patch({ strategies: toggle(value.strategies, v) })}
        />
      </div>

      <div className="space-y-2">
        <Label>Purchase price</Label>
        <div className="grid grid-cols-2 gap-2">
          <CurrencyInput
            placeholder="Min $"
            value={value.price_min}
            onValueChange={(v) => patch({ price_min: v })}
          />
          <CurrencyInput
            placeholder="Max $"
            value={value.price_max}
            onValueChange={(v) => patch({ price_max: v })}
          />
        </div>
      </div>

      <div className="space-y-2 rounded-lg border p-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            className="size-4 accent-amber-600"
            checked={value.exchange_1031}
            onChange={(e) =>
              patch({
                exchange_1031: e.target.checked,
                // the DB rejects a deadline without the flag, so clear it together
                exchange_deadline: e.target.checked ? value.exchange_deadline : '',
              })
            }
          />
          1031 exchange buyer
        </label>
        {value.exchange_1031 && (
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-1031`} className="text-xs text-muted-foreground">
              Identification / closing deadline
            </Label>
            <Input
              id={`${idPrefix}-1031`}
              type="date"
              value={value.exchange_deadline}
              onChange={(e) => patch({ exchange_deadline: e.target.value })}
            />
          </div>
        )}
      </div>

      {showAreas && (
        <div className="space-y-2">
          <Label>Where they'll buy</Label>
          <p className="text-xs text-muted-foreground">
            Type a county or city to drop its real boundary on the map, or draw a custom shape.
            An address is either inside an area or it isn't — nothing depends on spelling.
          </p>
          <AreaDrawMap areas={value.target_areas} onChange={(a) => patch({ target_areas: a })} />
        </div>
      )}
    </div>
  )
}

const num = (v: string) => numOrNull(v)

/** Criteria form state → the clients columns it writes. */
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
