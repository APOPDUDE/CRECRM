import { BadgeCheck } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Marks a contact we've actually confirmed — a `confirmed` owner_contacts link with a
 * verified_at stamp behind it, meaning someone had a real conversation on this number.
 * Deliberately not shown for `likely`/`unconfirmed` links: a skip-trace guess that shares
 * an address with a parcel is not verification, and a badge that appears on guesses stops
 * meaning anything.
 *
 * `label` off gives the bare icon for dense table rows.
 */
export function VerifiedBadge({
  label = true,
  className,
}: {
  label?: boolean
  className?: string
}) {
  return (
    <span
      title="Verified — confirmed on a real conversation"
      className={cn(
        'inline-flex shrink-0 items-center gap-1 text-emerald-600 dark:text-emerald-500',
        label &&
          'rounded-full bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium dark:bg-emerald-950/40',
        className,
      )}
    >
      <BadgeCheck className="size-3.5" aria-hidden="true" />
      {label ? 'Verified' : <span className="sr-only">Verified</span>}
    </span>
  )
}
