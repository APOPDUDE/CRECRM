import { useState } from 'react'
import { Check, Clipboard, Globe, MapPin } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

/**
 * The three ways you actually want to leave a property record: open it in Google Maps
 * (directions on the phone), drop into Google Earth (look at the roof, the yard, the
 * truck court), or copy the address to paste into an email or a listing.
 *
 * Deliberately NOT a link to the in-app Deal Map — the mini-map tile below already does
 * that, and having two controls a few pixels apart go to different maps is a trap.
 */
export function AddressActions({
  address,
  lat,
  lng,
  className,
}: {
  address: string
  lat?: number | null
  lng?: number | null
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  const q = encodeURIComponent(address)

  // Coordinates win when we hold them because a scraped address string can geocode to
  // the wrong side of a long rural road. Google's ?api=1 search URL opens the Google
  // Maps app on phones that have it.
  const hasCoords = typeof lat === 'number' && typeof lng === 'number'
  const mapsUrl = hasCoords
    ? `https://www.google.com/maps/search/?api=1&query=${lat}%2C${lng}`
    : `https://www.google.com/maps/search/?api=1&query=${q}`
  // Google Earth's web build has no documented ll= query param; its /search/ route is the
  // supported deep link and resolves the same address string.
  const earthUrl = `https://earth.google.com/web/search/${q}`

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      toast.success('Address copied')
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard API needs a secure context and can be blocked outright; say so rather
      // than flashing a success state for something that didn't happen.
      toast.error('Could not copy — your browser blocked clipboard access')
    }
  }

  const btn =
    'inline-flex size-7 items-center justify-center rounded-md border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'

  return (
    <span className={cn('inline-flex items-center gap-1 align-middle', className)}>
      <a
        href={mapsUrl}
        target="_blank"
        rel="noopener noreferrer"
        title="Open in Google Maps"
        className={btn}
        onClick={(e) => e.stopPropagation()}
      >
        <MapPin className="size-4" />
        <span className="sr-only">Open in Google Maps</span>
      </a>
      <a
        href={earthUrl}
        target="_blank"
        rel="noopener noreferrer"
        title="Open in Google Earth"
        className={btn}
        onClick={(e) => e.stopPropagation()}
      >
        <Globe className="size-4" />
        <span className="sr-only">Open in Google Earth</span>
      </a>
      <button type="button" onClick={copy} title="Copy address" className={btn}>
        {copied ? <Check className="size-4 text-emerald-600" /> : <Clipboard className="size-4" />}
        <span className="sr-only">Copy address</span>
      </button>
    </span>
  )
}
