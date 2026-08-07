// Copies call recordings out of expiring source links into our own Storage.
//
// Terrakotta presigns its S3 URLs with X-Amz-Expires=604800 -- seven days and the audio is
// gone. The conversation log currently holds those raw links, so every recording is on a
// timer. This pulls the bytes into the private `call-recordings` bucket and points the
// communications row at the local copy, which never expires.
//
// Auth: the caller must present a service_role JWT as the bearer token. Deliberately NOT a
// shared secret baked into the source like ghl-verify does -- this repo is public, so a
// literal token here would be a leak. n8n already holds the service-role key as a
// credential, so this needs no new secret anywhere.
//
// The check reads the JWT's role claim rather than string-comparing against the key we hold:
// the gateway runs with verify_jwt on and has already validated the signature against the
// project secret by the time this code executes, so the claims can be trusted. Comparing
// strings instead would break the moment the key is rotated on one side only.
//
// POST body (all optional):
//   { "limit": 25, "id": "<communication uuid>" }
// `id` archives one specific row (used right after a call is logged); otherwise it sweeps
// the backlog oldest-first, because the oldest link is the nearest to expiry.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const BUCKET = 'call-recordings'
// Recordings are minutes of speech, not media; anything far above this is not a call and
// we would rather fail loudly than quietly fill the bucket with an HTML error page.
const MAX_BYTES = 50 * 1024 * 1024
const DEFAULT_LIMIT = 25

type Row = { id: string; occurred_at: string; source_url: string }

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

/** mp3/wav/m4a from the response's own content-type, falling back to the URL's extension. */
function extensionFor(contentType: string | null, url: string): string {
  const ct = (contentType ?? '').toLowerCase()
  if (ct.includes('mpeg') || ct.includes('mp3')) return 'mp3'
  if (ct.includes('wav')) return 'wav'
  if (ct.includes('mp4') || ct.includes('m4a') || ct.includes('aac')) return 'm4a'
  const m = url.split('?')[0].match(/\.(mp3|wav|m4a)$/i)
  return m ? m[1].toLowerCase() : 'mp3'
}

/** Role claim out of an already-signature-verified bearer JWT. */
function roleOf(authHeader: string | null): string | null {
  const raw = (authHeader ?? '').replace(/^Bearer\s+/i, '')
  const seg = raw.split('.')[1]
  if (!seg) return null
  try {
    const b64 = seg.replace(/-/g, '+').replace(/_/g, '/')
    const pad = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    return JSON.parse(atob(pad))?.role ?? null
  } catch {
    return null
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  if (roleOf(req.headers.get('Authorization')) !== 'service_role') {
    return json({ error: 'service_role required' }, 401)
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  let body: { limit?: number; id?: string } = {}
  try {
    body = await req.json()
  } catch {
    // no body is fine -- sweep with defaults
  }
  const limit = Math.min(Math.max(Number(body.limit) || DEFAULT_LIMIT, 1), 100)

  let q = supabase
    .from('v_recordings_to_archive')
    .select('id, occurred_at, source_url')
    .limit(limit)
  if (body.id) q = q.eq('id', body.id)

  const { data, error } = await q
  if (error) return json({ error: error.message }, 500)

  const rows = (data ?? []) as Row[]
  const results: { id: string; ok: boolean; bytes?: number; error?: string }[] = []

  for (const row of rows) {
    try {
      const res = await fetch(row.source_url)
      if (!res.ok) {
        // S3 explains itself in an XML body (ExpiredToken, SignatureDoesNotMatch,
        // AccessDenied...). Carry that through instead of just the status code -- "400"
        // alone is unactionable, and the distinction between "link died" and "we mangled
        // the URL" is the whole diagnosis.
        let detail = ''
        try {
          const text = (await res.text()).replace(/\s+/g, ' ').trim()
          const code = text.match(/<Code>([^<]+)<\/Code>/)?.[1]
          const msg = text.match(/<Message>([^<]+)<\/Message>/)?.[1]
          detail = code ? ` ${code}${msg ? `: ${msg}` : ''}` : ` ${text.slice(0, 180)}`
        } catch {
          // body unreadable -- the status alone will have to do
        }
        throw new Error(`source responded ${res.status}${detail}`)
      }

      const ct = res.headers.get('content-type')
      // A presigned S3 link that has expired returns XML, not audio. Catch that before we
      // write it to Storage and call it a recording.
      if (ct && /(text\/html|application\/xml|text\/xml)/i.test(ct)) {
        throw new Error(`source returned ${ct}, not audio`)
      }

      const buf = new Uint8Array(await res.arrayBuffer())
      if (buf.byteLength === 0) throw new Error('source returned 0 bytes')
      if (buf.byteLength > MAX_BYTES) throw new Error(`source too large (${buf.byteLength} bytes)`)

      const ext = extensionFor(ct, row.source_url)
      // Foldered by month so the bucket stays browsable as this grows; the communication id
      // makes the key unique and lets a row find its own audio without a second lookup.
      const month = (row.occurred_at ?? '').slice(0, 7) || 'unknown'
      const path = `${month}/${row.id}.${ext}`

      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, buf, {
          contentType: ct ?? 'audio/mpeg',
          upsert: true,
        })
      if (upErr) throw new Error(`storage upload failed: ${upErr.message}`)

      const { error: updErr } = await supabase
        .from('communications')
        .update({
          recording_path: path,
          recording_bytes: buf.byteLength,
          recording_synced_at: new Date().toISOString(),
          recording_error: null,
        })
        .eq('id', row.id)
      if (updErr) throw new Error(`row update failed: ${updErr.message}`)

      results.push({ id: row.id, ok: true, bytes: buf.byteLength })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      // Stamp the failure but leave recording_path null, so a later sweep retries it. A
      // permanently dead link keeps reappearing, which is correct: the error text is the
      // record that the audio is gone.
      await supabase
        .from('communications')
        .update({ recording_error: message })
        .eq('id', row.id)
      results.push({ id: row.id, ok: false, error: message })
    }
  }

  const archived = results.filter((r) => r.ok).length
  return json({
    ok: true,
    considered: rows.length,
    archived,
    failed: results.length - archived,
    results,
  })
})
