import { Copy, Mail, Phone } from 'lucide-react'
import { toast } from 'sonner'
import { ghlContactUrl } from '@/lib/ghl'

/**
 * Shows a contact's phone + email. The phone number opens the contact in GHL (new
 * tab — call from there on the GHL line); the copy icon still copies. Email stays
 * click-to-copy. Without a ghl_contact_id the phone falls back to click-to-copy —
 * never tel:, which desktop Safari routes to FaceTime.
 */
export function ContactActions({
  phone,
  email,
  ghlContactId,
}: {
  phone?: string | null
  email?: string | null
  ghlContactId?: string | null
}) {
  if (!phone && !email) return null

  const copy = (label: string, value: string) => (e: React.MouseEvent) => {
    e.stopPropagation()
    const done = () => toast.success(`${label} copied`)
    const fail = () => toast.error(`Could not copy ${label.toLowerCase()}`)
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(value).then(done, fail)
    } else {
      fail()
    }
  }

  const rowClass =
    'group/c flex w-full items-center gap-1.5 text-left text-muted-foreground transition-colors hover:text-foreground'

  return (
    <div className="mt-2 space-y-1 text-xs">
      {phone && ghlContactId ? (
        <span className={rowClass}>
          <Phone className="size-3.5 shrink-0" />
          <a
            href={ghlContactUrl(ghlContactId)}
            target="_blank"
            rel="noopener noreferrer"
            title="Call via GHL"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            className="truncate tabular-nums text-primary hover:underline"
          >
            {phone}
          </a>
          <button
            type="button"
            onClick={copy('Phone', phone)}
            onPointerDown={(e) => e.stopPropagation()}
            title="Copy phone"
            className="shrink-0"
          >
            <Copy className="size-3 opacity-0 transition-opacity group-hover/c:opacity-100" />
          </button>
        </span>
      ) : phone ? (
        <button
          type="button"
          onClick={copy('Phone', phone)}
          onPointerDown={(e) => e.stopPropagation()}
          title="Copy phone"
          className={rowClass}
        >
          <Phone className="size-3.5 shrink-0" />
          <span className="truncate tabular-nums">{phone}</span>
          <Copy className="size-3 shrink-0 opacity-0 transition-opacity group-hover/c:opacity-100" />
        </button>
      ) : null}
      {email && (
        <button
          type="button"
          onClick={copy('Email', email)}
          onPointerDown={(e) => e.stopPropagation()}
          title="Copy email"
          className={rowClass}
        >
          <Mail className="size-3.5 shrink-0" />
          <span className="truncate">{email}</span>
          <Copy className="size-3 shrink-0 opacity-0 transition-opacity group-hover/c:opacity-100" />
        </button>
      )}
    </div>
  )
}
