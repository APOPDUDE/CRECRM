import { ShoppingBag } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Marks a buyer wherever their contact appears, so you know before opening them.
 *
 * Two states, deliberately different colours: a plain badge is a real buyer on the roster with
 * criteria behind them, amber means they've been called a buyer but nobody has said what they
 * buy yet — they're on the Buyers strip waiting, and they reach no blast list or match until
 * that's done. Reading them as the same thing is exactly the mistake the review queue exists
 * to prevent.
 */
export function BuyerBadge({
  pending = false,
  className,
}: {
  pending?: boolean
  className?: string
}) {
  return (
    <span
      title={
        pending
          ? 'Marked as a buyer — waiting on their buying criteria'
          : 'Buyer — on the buyers roster'
      }
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium',
        pending
          ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-500'
          : 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400',
        className,
      )}
    >
      <ShoppingBag className="size-3.5" aria-hidden="true" />
      {pending ? 'Buyer pending' : 'Buyer'}
    </span>
  )
}
