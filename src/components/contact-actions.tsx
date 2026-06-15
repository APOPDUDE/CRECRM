import { Mail, Phone } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** Click-to-call / click-to-email buttons for a contact. Renders nothing when both are missing. */
export function ContactActions({
  phone,
  email,
}: {
  phone?: string | null
  email?: string | null
}) {
  if (!phone && !email) return null
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {phone && (
        <Button asChild size="sm" variant="outline" className="h-7 px-2 text-xs">
          <a href={`tel:${phone}`} onClick={(e) => e.stopPropagation()}>
            <Phone className="size-3.5" />
            Call
          </a>
        </Button>
      )}
      {email && (
        <Button asChild size="sm" variant="outline" className="h-7 px-2 text-xs">
          <a href={`mailto:${email}`} onClick={(e) => e.stopPropagation()}>
            <Mail className="size-3.5" />
            Email
          </a>
        </Button>
      )}
    </div>
  )
}
