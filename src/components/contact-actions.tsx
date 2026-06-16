import { Copy, Mail, Phone } from 'lucide-react'
import { toast } from 'sonner'

/**
 * Shows a contact's phone + email as click-to-copy rows. Clicking either copies
 * the value to the clipboard (it reads as text but behaves like a button).
 */
export function ContactActions({
  phone,
  email,
}: {
  phone?: string | null
  email?: string | null
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

  return (
    <div className="mt-2 space-y-1 text-xs">
      {phone && (
        <button
          type="button"
          onClick={copy('Phone', phone)}
          onPointerDown={(e) => e.stopPropagation()}
          title="Copy phone"
          className="group/c flex w-full items-center gap-1.5 text-left text-muted-foreground transition-colors hover:text-foreground"
        >
          <Phone className="size-3.5 shrink-0" />
          <span className="truncate tabular-nums">{phone}</span>
          <Copy className="size-3 shrink-0 opacity-0 transition-opacity group-hover/c:opacity-100" />
        </button>
      )}
      {email && (
        <button
          type="button"
          onClick={copy('Email', email)}
          onPointerDown={(e) => e.stopPropagation()}
          title="Copy email"
          className="group/c flex w-full items-center gap-1.5 text-left text-muted-foreground transition-colors hover:text-foreground"
        >
          <Mail className="size-3.5 shrink-0" />
          <span className="truncate">{email}</span>
          <Copy className="size-3 shrink-0 opacity-0 transition-opacity group-hover/c:opacity-100" />
        </button>
      )}
    </div>
  )
}
