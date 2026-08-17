import { useMemo, useRef, useState } from 'react'
import { CheckCircle2, FileUp, Loader2, Send, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { supabase } from '@/lib/supabase'
import { automationEnabled, callN8nWebhook, N8N_PATHS } from '@/lib/n8n'

/**
 * Terrakotta import — THE ONLY DOOR into the outreach spine.
 *
 * A skiptraced list imports ONCE, here. Each row becomes (or merges into) one PERSON in
 * outreach_targets plus a row per channel that has data — phone, email, mailing address — all
 * tagged with this list's name. From then on the list lives in Supabase and building an
 * audience is a query. GHL is a push destination for the phone channel, never the source of
 * truth: the Nicole list went straight into GHL once (552 created, 45 tagged) and nobody could
 * reconcile it, which is the failure this page exists to make impossible.
 *
 * All matching lives in the import_outreach_targets RPC (phone → email → name+anchor, the
 * shared-landline guard, unambiguous-only property resolution, wrong person → wrong number).
 * This page only parses the CSV, maps headers, and shows the report.
 */

/** Header synonyms, lowercased — same table scripts/tk-to-ghl.py used. Terrakotta renames
 *  columns between exports, so match on meaning, not exact spelling. */
const SYN: Record<string, string[]> = {
  phone: ['phone number', 'phone', 'owner contact phone', 'mobile', 'number'],
  first_name: ['first name', 'firstname'],
  last_name: ['last name', 'lastname'],
  full_name: ['full name', 'owner contact name', 'decision maker', 'contact name'],
  email: ['primary email', 'owner contact email', 'personal email'],
  // The bare "email" column in a Terrakotta export is the ENTITY email (info@…) — recorded in
  // raw by the RPC, never used as the person's address.
  entity_email: ['email', 'company email', 'entity email'],
  company_name: ['owner name', 'owner', 'buyer entity', 'entity', 'company', 'company name'],
  property_address: ['property address', 'address', 'site address', 'situs address'],
  property_city: ['property city', 'site city', 'city'],
  parcel_id: ['parcel id', 'parcel number', 'parcel', 'folio', 'strap'],
  mailing_address: ['mailing address', 'owner mailing address', 'mail address'],
  mailing_city: ['mailing city', 'owner mailing city'],
  mailing_state: ['mailing state', 'owner mailing state'],
  mailing_zip: ['mailing zip', 'owner mailing zip', 'mail zip'],
  phone_grade: ['*verified grade', 'verified grade', 'phone grade', 'grade'],
  line_type: ['*verified type', 'verified type', 'line type', 'phone type detail'],
  disposition: ['tk_disposition', 'disposition', 'call disposition'],
}

/** Minimal RFC-4180 CSV parser — quoted fields, embedded commas/newlines. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.some((f) => f.trim() !== '')) rows.push(row)
      row = []
    } else field += c
  }
  if (field !== '' || row.length) {
    row.push(field)
    if (row.some((f) => f.trim() !== '')) rows.push(row)
  }
  return rows
}

function mapHeaders(headers: string[]): Record<number, string> {
  const mapping: Record<number, string> = {}
  const taken = new Set<string>()
  // Two passes: exact synonym match wins over a looser contains-match, and earlier synonyms
  // outrank later ones ("primary email" must claim email before bare "email" grabs it).
  for (const [field, syns] of Object.entries(SYN)) {
    for (const syn of syns) {
      const idx = headers.findIndex(
        (h, i) => !(i in mapping) && h.trim().toLowerCase() === syn,
      )
      if (idx >= 0 && !taken.has(field)) {
        mapping[idx] = field
        taken.add(field)
        break
      }
    }
  }
  return mapping
}

type ImportReport = {
  ok: boolean
  reason?: string
  list: string
  rows: number
  skipped_unreachable: number
  new: number
  existing: number
  already_verified: number
  new_phone_rows: number
  new_email_rows: number
  new_mail_rows: number
  matched_by_phone: number
  matched_by_email: number
  matched_by_name_anchor: number
  held: number
  held_detail: { name: string; reason: string }[]
}

export function OutreachImportPage() {
  const [listName, setListName] = useState('')
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState<Record<string, string>[]>([])
  const [mappedFields, setMappedFields] = useState<string[]>([])
  const [unmappedHeaders, setUnmappedHeaders] = useState<string[]>([])
  const [importing, setImporting] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [report, setReport] = useState<ImportReport | null>(null)
  const [pushed, setPushed] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const listSlug = useMemo(() => {
    const raw = listName.trim().toLowerCase().replace(/\s+/g, '-')
    if (!raw) return ''
    return raw.startsWith('list-') ? raw : `list-${raw}`
  }, [listName])

  const onFile = async (f: File) => {
    const text = await f.text()
    const parsed = parseCsv(text)
    if (parsed.length < 2) {
      toast.error('That file has no data rows.')
      return
    }
    const headers = parsed[0]
    const mapping = mapHeaders(headers)
    const mapped = Object.values(mapping)
    if (!mapped.some((m) => ['phone', 'email', 'mailing_address'].includes(m))) {
      toast.error('No phone, email or mailing-address column found — nothing to import.')
      return
    }
    const out: Record<string, string>[] = []
    for (const r of parsed.slice(1)) {
      const obj: Record<string, string> = {}
      for (const [idxStr, field] of Object.entries(mapping)) {
        const v = (r[Number(idxStr)] ?? '').trim()
        if (v) obj[field] = v
      }
      // A full name splits only when there are no dedicated name columns.
      if (obj.full_name && !obj.first_name) {
        const parts = obj.full_name.split(/\s+/)
        obj.first_name = parts[0]
        if (parts.length > 1) obj.last_name = parts.slice(1).join(' ')
      }
      delete obj.full_name
      if (Object.keys(obj).length) out.push(obj)
    }
    setFileName(f.name)
    setRows(out)
    setMappedFields(mapped.filter((m) => m !== 'full_name'))
    setUnmappedHeaders(
      headers.filter((_, i) => !(i in mapping)).map((h) => h.trim()).filter(Boolean),
    )
    setReport(null)
    setPushed(false)
    if (!listName) {
      setListName(f.name.replace(/\.csv$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-'))
    }
  }

  const runImport = async () => {
    if (!listSlug) {
      toast.error('Name the list first.')
      return
    }
    if (!rows.length) return
    setImporting(true)
    try {
      const totals: Partial<ImportReport> = {}
      const held: { name: string; reason: string }[] = []
      for (let i = 0; i < rows.length; i += 500) {
        const { data, error } = await supabase.rpc('import_outreach_targets', {
          p: { list: listSlug, source: 'terrakotta', rows: rows.slice(i, i + 500) },
        })
        if (error) throw error
        const d = data as unknown as ImportReport
        if (!d.ok) throw new Error(d.reason ?? 'Import failed')
        for (const [k, v] of Object.entries(d)) {
          if (typeof v === 'number') {
            ;(totals as Record<string, number>)[k] =
              ((totals as Record<string, number>)[k] ?? 0) + v
          }
        }
        held.push(...(d.held_detail ?? []))
      }
      setReport({ ...(totals as ImportReport), ok: true, list: listSlug, held_detail: held })
      toast.success(`Imported ${listSlug}: ${totals.new ?? 0} new, ${totals.existing ?? 0} existing.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The import failed.')
    } finally {
      setImporting(false)
    }
  }

  const pushToGhl = async () => {
    setPushing(true)
    try {
      await callN8nWebhook(
        `${N8N_PATHS.outreachGhlPush}?key=axis-2026`,
        { list: listSlug },
        { timeoutMs: 30_000 },
      )
      setPushed(true)
      toast.success(`Pushing ${listSlug} to GHL — Slack will confirm when the tagging is done.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The GHL push failed.')
    } finally {
      setPushing(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Import a skiptraced list</h1>
        <p className="text-xs text-muted-foreground">
          One import, three channels — the list lives here from now on, not in GHL.
        </p>
      </div>

      {/* ------------------------------------------------------------------ 1. File */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileUp className="size-4" /> 1 · The CSV
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="list-name">List name</Label>
              <Input
                id="list-name"
                value={listName}
                onChange={(e) => setListName(e.target.value)}
                placeholder="nicole-november"
                className="w-64"
              />
              {listSlug ? (
                <p className="text-xs text-muted-foreground">
                  Stored as <code>{listSlug}</code>; GHL contacts get tagged the same.
                </p>
              ) : null}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void onFile(f)
                e.target.value = ''
              }}
            />
            <Button variant="outline" onClick={() => fileRef.current?.click()}>
              <Upload className="size-4" /> {fileName ? 'Pick a different file' : 'Pick the CSV'}
            </Button>
            {fileName ? (
              <span className="text-sm text-muted-foreground">
                {fileName} · {rows.length} rows
              </span>
            ) : null}
          </div>

          {rows.length ? (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                {mappedFields.map((f) => (
                  <Badge key={f} variant="outline" className="border-emerald-200 bg-emerald-50">
                    {f.replace(/_/g, ' ')}
                  </Badge>
                ))}
                {unmappedHeaders.map((h) => (
                  <Badge key={h} variant="outline" className="text-muted-foreground">
                    {h} — ignored
                  </Badge>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Matching, property resolution and dedupe all happen in the database: phone first,
                then email, then name + property/company — never name alone, and a shared
                landline never drags somebody else’s email onto the wrong person. “Wrong person”
                dispositions import as <strong>wrong number</strong> — the phone was bad, the
                human stays mailable.
              </p>
              <Button onClick={runImport} disabled={importing || !listSlug}>
                {importing ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Importing…
                  </>
                ) : (
                  `Import ${rows.length} rows as ${listSlug || '…'}`
                )}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------------ 2. Report */}
      {report ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="size-4 text-emerald-600" /> 2 · What happened
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm">
              <span className="font-semibold">{report.new} new people</span>
              {' · '}
              <span>{report.existing} existing</span>
              {' · '}
              <span className={report.already_verified ? 'font-medium text-amber-700' : ''}>
                {report.already_verified} already verified in the book
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <div>
                new phone rows <span className="font-medium tabular-nums">{report.new_phone_rows}</span>
              </div>
              <div>
                new email rows <span className="font-medium tabular-nums">{report.new_email_rows}</span>
              </div>
              <div>
                new mailing rows <span className="font-medium tabular-nums">{report.new_mail_rows}</span>
              </div>
              <div>
                matched by phone <span className="font-medium tabular-nums">{report.matched_by_phone}</span>
              </div>
              <div>
                by email <span className="font-medium tabular-nums">{report.matched_by_email}</span>
              </div>
              <div>
                by name + anchor{' '}
                <span className="font-medium tabular-nums">{report.matched_by_name_anchor}</span>
              </div>
            </div>
            {report.skipped_unreachable ? (
              <p className="text-xs text-muted-foreground">
                {report.skipped_unreachable} rows had no phone, email or mailing address and were
                skipped.
              </p>
            ) : null}
            {report.held ? (
              <div className="space-y-2">
                <div className="text-sm font-medium text-amber-700">
                  Held for a look: {report.held}
                </div>
                <div className="max-h-48 overflow-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Who</TableHead>
                        <TableHead>Why</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.held_detail.map((h, i) => (
                        <TableRow key={i}>
                          <TableCell className="text-sm">{h.name}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {h.reason.replace(/_/g, ' ')}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <p className="text-xs text-muted-foreground">
                  Held people are imported — they just need a human eye (ambiguous property, a
                  shared landline with a different email, or an address on another person).
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* ------------------------------------------------------------------ 3. GHL push */}
      {report && automationEnabled() ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Send className="size-4" /> 3 · Push the phone channel to GHL
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Upserts one GHL contact per phone number (exact-phone match, email into the{' '}
              <code>Owner Email</code> custom field) and tags them all <code>{report.list}</code>{' '}
              so the dialer can pick the list up. GHL is a mirror — the list itself lives here.
            </p>
            <Button onClick={pushToGhl} disabled={pushing || pushed}>
              {pushing ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Pushing…
                </>
              ) : pushed ? (
                'Pushed — check Slack'
              ) : (
                `Push ${report.list} to GHL`
              )}
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

export default OutreachImportPage
