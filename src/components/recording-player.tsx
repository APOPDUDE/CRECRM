import { useState } from 'react'
import { AlertTriangle, Loader2, Play } from 'lucide-react'
import { supabase } from '@/lib/supabase'

const BUCKET = 'call-recordings'
/** Long enough to listen through a call without re-signing mid-playback. */
const SIGNED_URL_TTL_SECONDS = 3600

/** Rough weight of the file, so you know a 3-second hangup from a real conversation. */
function formatBytes(bytes: number | null | undefined): string | null {
  if (!bytes) return null
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/**
 * The archived audio behind one communication.
 *
 * Renders nothing at all when there is no recording — most rows are notes and emails,
 * and an empty player on every one of them is noise. When the archiver failed we show
 * why instead: the source links (Terrakotta/GHL) carry an STS token that dies about an
 * hour after the call, so a dead link is a permanent fact worth stating, not a blank.
 *
 * The bucket is private, so the URL is signed — lazily, on play. A contact page can
 * hold 200 rows and minting a signed URL for each one on render would be 200 requests
 * for audio nobody asked to hear.
 */
export function RecordingPlayer({
  path,
  bytes,
  error,
}: {
  path: string | null
  bytes: number | null
  error: string | null
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [signError, setSignError] = useState<string | null>(null)

  if (!path) {
    if (!error) return null
    return (
      <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-700">
        <AlertTriangle className="size-3.5 shrink-0" />
        <span>Recording unavailable — {error}</span>
      </p>
    )
  }

  const play = async () => {
    setLoading(true)
    setSignError(null)
    const { data, error: err } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
    setLoading(false)
    if (err || !data) {
      setSignError(err?.message ?? 'could not open the recording')
      return
    }
    setUrl(data.signedUrl)
  }

  if (url) {
    // The archive holds both .wav and .mp3 — <audio> picks the decoder off the real path.
    return <audio src={url} controls autoPlay preload="auto" className="mt-2 h-9 w-full max-w-sm" />
  }

  const size = formatBytes(bytes)
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={play}
        disabled={loading}
        className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
      >
        {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
        Play recording
        {size && <span className="text-[10px] opacity-70">{size}</span>}
      </button>
      {signError && <p className="mt-1 text-xs text-red-600">Could not open the recording — {signError}</p>}
    </div>
  )
}
