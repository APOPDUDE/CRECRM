import { Phone } from 'lucide-react'
import { ghlContactUrl } from '@/lib/ghl'
import { cn } from '@/lib/utils'

/**
 * A phone number that dials through GHL: opens the contact's GHL page in a new tab,
 * where the call button uses the GHL line — not the phone's own number. Contacts the
 * push hasn't linked yet (no ghl_contact_id) fall back to a plain tel: link so the
 * number is never dead.
 */
export function GhlPhoneLink({
  phone,
  ghlContactId,
  className,
}: {
  phone: string
  ghlContactId: string | null | undefined
  className?: string
}) {
  const href = ghlContactId ? ghlContactUrl(ghlContactId) : `tel:${phone.replace(/[^\d+]/g, '')}`
  return (
    <a
      href={href}
      {...(ghlContactId ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      onClick={(e) => e.stopPropagation()}
      title={ghlContactId ? 'Call via GHL' : 'No GHL contact linked — dials directly'}
      className={cn(
        'inline-flex items-center gap-1 font-medium text-primary hover:underline',
        className,
      )}
    >
      <Phone className="size-3" />
      {phone}
    </a>
  )
}
