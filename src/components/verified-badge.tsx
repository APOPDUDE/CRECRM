import { BadgeCheck } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Marks a contact we've actually confirmed — a `contacts.verified_at` stamp, meaning
 * someone had a real conversation on this number. Deliberately not shown for unverified
 * rows: a skip-trace guess that shares an address with a parcel is not verification, and
 * a badge that appears on guesses stops meaning anything.
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

/**
 * Marks an EMAIL ADDRESS that is proven to reach the person — a reply or an
 * out-of-office came back from a campaign.
 *
 * Sits beside the address itself, never beside the person's name, because that is the
 * exact extent of what it claims (Alex): the mail arrives. It says nothing about the
 * phone number on the same record, and nothing about whether they own the building. The
 * conversation badge above is a different, stronger claim, and the two must not be
 * mistaken for each other — hence a different colour and its own wording.
 */
export function EmailVerifiedBadge({
  label = true,
  className,
}: {
  label?: boolean
  className?: string
}) {
  return (
    <span
      title="Email verified — a reply or out-of-office came back from this address"
      className={cn(
        'inline-flex shrink-0 items-center gap-1 text-blue-600 dark:text-blue-400',
        label &&
          'rounded-full bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium dark:bg-blue-950/40',
        className,
      )}
    >
      <BadgeCheck className="size-3.5" aria-hidden="true" />
      {label ? 'Email verified' : <span className="sr-only">Email verified</span>}
    </span>
  )
}
