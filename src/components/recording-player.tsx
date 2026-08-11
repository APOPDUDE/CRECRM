import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Loader2, Pause, Play } from 'lucide-react'
import { supabase } from '@/lib/supabase'

const BUCKET = 'call-recordings'
/** Long enough to listen through a call without re-signing mid-playback. */
const SIGNED_URL_TTL_SECONDS = 3600
/** Skim speeds. Most of these calls are a hello and a hang-up; 2x makes that 10 seconds. */
const SPEEDS = [1, 1.5, 2]

function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const s = Math.floor(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Rough weight of the file — the fallback when the note never stated a duration. */
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
 *
 * The controls are hand-built rather than the browser's, because the native player
 * cannot be coloured and cannot offer a speed control where it is actually wanted.
 */
export function RecordingPlayer({
  path,
  bytes,
  error,
  durationLabel,
  transcript,
}: {
  path: string | null
  bytes: number | null
  error: string | null
  /** "0:27" pulled off the row when it says so — better than a file size on the button. */
  durationLabel?: string | null
  transcript?: string | null
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [signError, setSignError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [total, setTotal] = useState(0)
  const [speedIdx, setSpeedIdx] = useState(0)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Speed has to be re-applied to the element, not just held in state — and again after
  // any load, since a fresh source resets playbackRate to 1.
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = SPEEDS[speedIdx]
  }, [speedIdx, url])

  if (!path) {
    if (!error) return null
    return (
      <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-700">
        <AlertTriangle className="size-3.5 shrink-0" />
        <span>Recording unavailable — {error}</span>
      </p>
    )
  }

  const openRecording = async () => {
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

  const toggle = () => {
    const el = audioRef.current
    if (!el) return
    if (el.paused) void el.play()
    else el.pause()
  }

  const label = durationLabel || formatBytes(bytes)

  if (!url) {
    return (
      <div className="mt-2">
        <button
          type="button"
          onClick={openRecording}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:border-red-300 hover:bg-red-100 disabled:opacity-60"
        >
          {loading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Play className="size-4 fill-current" />
          )}
          Play recording
          {label && <span className="text-xs font-normal opacity-70">{label}</span>}
        </button>
        {signError && (
          <p className="mt-1 text-xs text-red-600">Could not open the recording — {signError}</p>
        )}
      </div>
    )
  }

  const pct = total > 0 ? (current / total) * 100 : 0

  return (
    <div className="mt-2 space-y-2">
      <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50/60 p-3">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? 'Pause recording' : 'Play recording'}
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-red-600 text-white transition-colors hover:bg-red-700"
        >
          {playing ? (
            <Pause className="size-5 fill-current" />
          ) : (
            <Play className="size-5 translate-x-px fill-current" />
          )}
        </button>

        <div className="min-w-0 flex-1">
          <input
            type="range"
            min={0}
            max={total || 0}
            step={0.1}
            value={current}
            aria-label="Seek"
            onChange={(e) => {
              const el = audioRef.current
              if (!el) return
              el.currentTime = Number(e.target.value)
              setCurrent(Number(e.target.value))
            }}
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-red-200 accent-red-600"
            style={{
              background: `linear-gradient(to right, rgb(220 38 38) ${pct}%, rgb(254 202 202) ${pct}%)`,
            }}
          />
          <div className="mt-1 flex items-center justify-between text-xs tabular-nums text-red-900/70">
            <span>
              {clock(current)} / {clock(total)}
            </span>
            <button
              type="button"
              onClick={() => setSpeedIdx((i) => (i + 1) % SPEEDS.length)}
              title="Playback speed"
              className="rounded border border-red-200 bg-white px-1.5 py-0.5 font-medium text-red-700 transition-colors hover:bg-red-100"
            >
              {SPEEDS[speedIdx]}x
            </button>
          </div>
        </div>
      </div>

      {/* The archive holds both .wav and .mp3 — <audio> picks the decoder off the real path. */}
      <audio
        ref={audioRef}
        src={url}
        autoPlay
        preload="auto"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          setTotal(e.currentTarget.duration)
          e.currentTarget.playbackRate = SPEEDS[speedIdx]
        }}
        className="hidden"
      />

      {transcript && (
        <div className="max-h-48 overflow-y-auto rounded-md border bg-card p-2 text-xs leading-relaxed whitespace-pre-line text-muted-foreground">
          {transcript}
        </div>
      )}
    </div>
  )
}
