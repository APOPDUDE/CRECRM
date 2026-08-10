import type { ComponentProps } from 'react'
import { Input } from '@/components/ui/input'
import { groupDigits, ungroupDigits } from '@/lib/format'

type InputProps = Omit<ComponentProps<typeof Input>, 'value' | 'onChange' | 'type'>

export interface CurrencyInputProps extends InputProps {
  /** The raw, comma-free value. Callers keep storing and parsing plain digits. */
  value: string
  onValueChange: (value: string) => void
}

/**
 * A money (or square-foot) field that shows thousands separators AS YOU TYPE, so
 * 1000 reads as 1,000 and you can see at a glance whether you typed a million or ten.
 *
 * It is `type="text"`, not `type="number"` — a number input rejects the commas. The
 * grouping is display-only: `onValueChange` always receives the comma-free string, so
 * every existing `numOrNull(...)` save path keeps working untouched.
 */
export function CurrencyInput({ value, onValueChange, ...rest }: CurrencyInputProps) {
  return (
    <Input
      {...rest}
      type="text"
      inputMode="decimal"
      value={groupDigits(value)}
      onChange={(e) => onValueChange(ungroupDigits(e.target.value))}
    />
  )
}
