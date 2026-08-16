import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { ExternalLink, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { fetchPages } from '@/lib/paged-fetch'
import { supabase } from '@/lib/supabase'
import { OVERLAY_COLORS, type OverlayType } from '@/lib/overlays'
import { zoningKindLabels } from '@/lib/zoning'
import { zoningSourceFor } from '@/lib/zoning-sources'
import type { Tables } from '@/lib/database.types'

type CodeRow = Pick<
  Tables<'zoning_code_map'>,
  'jurisdiction' | 'code' | 'zoning_type' | 'allows_industrial' | 'description'
>

/** The whole map — a few hundred rows, cheap, cached hard. */
function useZoningCodeMap() {
  return useQuery({
    queryKey: ['zoning-code-map-all'],
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const rows: CodeRow[] = []
      for (let off = 0; ; off += 1000) {
        const r = await supabase
          .from('zoning_code_map')
          .select('jurisdiction, code, zoning_type, allows_industrial, description')
          .order('jurisdiction')
          .order('code')
          .range(off, off + 999)
        if (r.error) throw r.error
        rows.push(...((r.data ?? []) as CodeRow[]))
        if ((r.data ?? []).length < 1000) break
      }
      return rows
    },
  })
}

/**
 * How many book properties carry each (jurisdiction, code) — the number that turns an
 * abstract code list into "which districts actually matter to us". Two narrow columns
 * over the whole book, paged by uuid-range buckets (never OFFSET — see use-owners.ts).
 */
function useZoningCodeCounts() {
  return useQuery({
    queryKey: ['zoning-code-counts'],
    staleTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const BUCKETS = 32
      const bound = (i: number) =>
        `${(i * 8).toString(16).padStart(2, '0')}000000-0000-0000-0000-000000000000`
      const pages = await fetchPages(BUCKETS, async (i) => {
        const rows: { zoning_jurisdiction: string | null; zoning_code: string | null }[] = []
        let after: string | null = null
        for (;;) {
          let q = supabase
            .from('properties')
            .select('id, zoning_jurisdiction, zoning_code')
            .not('zoning_code', 'is', null)
            .order('id')
            .gte('id', bound(i))
            .limit(1000)
          if (i < BUCKETS - 1) q = q.lt('id', bound(i + 1))
          if (after) q = q.gt('id', after)
          const r = await q
          if (r.error) throw r.error
          const page = r.data ?? []
          rows.push(...page)
          if (page.length < 1000) break
          after = page[page.length - 1].id as string
        }
        return rows
      })
      const counts = new Map<string, number>()
      for (const rows of pages) {
        for (const row of rows) {
          if (!row.zoning_jurisdiction || !row.zoning_code) continue
          const k = `${row.zoning_jurisdiction}|${row.zoning_code}`
          counts.set(k, (counts.get(k) ?? 0) + 1)
        }
      }
      return counts
    },
  })
}

const TYPE_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'ind_ok', label: 'Industrial-capable' },
  { key: 'industrial', label: 'Industrial' },
  { key: 'retail', label: 'Retail' },
  { key: 'office', label: 'Office' },
  { key: 'multifamily', label: 'Multifamily' },
] as const
type TypeFilter = (typeof TYPE_FILTERS)[number]['key']

function typeBadge(row: CodeRow) {
  const t = row.zoning_type as OverlayType | string | null
  const color = t && t in OVERLAY_COLORS ? OVERLAY_COLORS[t as OverlayType] : null
  const label = t ? (zoningKindLabels as Record<string, string>)[t] ?? t : 'unclassified'
  return (
    <Badge variant="outline" className="gap-1.5 font-normal">
      {color && (
        <span className="inline-block size-2 rounded-full" style={{ backgroundColor: color }} />
      )}
      {label}
    </Badge>
  )
}

/**
 * Every zoning code we track, standardized across the six counties and their cities:
 * what the jurisdiction calls it, what it means, which of Alex's buckets it falls in,
 * whether industrial use is allowed, and how many book properties sit in it — with a
 * reference link back to the county's own source for the authoritative permitted-use
 * detail (Alex 2026-08-16: "a page that has all the zoning information from all the
 * counties standardized … with references that link back to the county").
 *
 * ?j=<jurisdiction>&c=<code> (the property page's zoning stat links here) scrolls to
 * and highlights that code.
 */
export default function ZoningLibraryPage() {
  const { data: codes, isLoading } = useZoningCodeMap()
  const { data: counts } = useZoningCodeCounts()
  const [params] = useSearchParams()
  const focusJ = params.get('j')
  const focusC = params.get('c')
  const [search, setSearch] = useState('')
  const [type, setType] = useState<TypeFilter>('all')
  const focusRef = useRef<HTMLTableRowElement | null>(null)

  useEffect(() => {
    // after data lands, bring the focused code into view once
    if (focusRef.current) focusRef.current.scrollIntoView({ block: 'center' })
  }, [codes])

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rows = (codes ?? []).filter((r) => {
      if (type === 'ind_ok' && !r.allows_industrial) return false
      if (type !== 'all' && type !== 'ind_ok' && r.zoning_type !== type) return false
      if (!q) return true
      return (
        r.code.toLowerCase().includes(q) ||
        (r.description ?? '').toLowerCase().includes(q) ||
        r.jurisdiction.toLowerCase().includes(q)
      )
    })
    const byJur = new Map<string, CodeRow[]>()
    for (const r of rows) {
      const g = byJur.get(r.jurisdiction)
      if (g) g.push(r)
      else byJur.set(r.jurisdiction, [r])
    }
    // heaviest jurisdictions first — the ones the book actually lives in
    const weight = (j: string, list: CodeRow[]) =>
      list.reduce((n, r) => n + (counts?.get(`${j}|${r.code}`) ?? 0), 0)
    return [...byJur.entries()].sort((a, b) => weight(b[0], b[1]) - weight(a[0], a[1]))
  }, [codes, counts, search, type])

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Zoning library</h1>
        <p className="text-sm text-muted-foreground">
          Every zoning district we track across the six counties, standardized into the four
          buckets. The county's own code is the authority on permitted uses — each
          jurisdiction links to its source.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search codes, descriptions, jurisdictions…"
            className="pl-8"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setType(f.key)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                type === f.key
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'bg-background hover:bg-accent'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          Loading the code map…
        </p>
      )}
      {!isLoading && groups.length === 0 && (
        <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          Nothing matches — clear the search or pick another bucket.
        </p>
      )}

      {groups.map(([jurisdiction, rows]) => {
        const src = zoningSourceFor(jurisdiction)
        return (
          <section key={jurisdiction} className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold">
                {jurisdiction}
                <span className="ml-2 font-normal text-muted-foreground">
                  {rows.length} code{rows.length === 1 ? '' : 's'}
                </span>
              </h2>
              {src && (
                <a
                  href={src.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  {src.label}
                  <ExternalLink className="size-3" />
                </a>
              )}
            </div>
            <div className="overflow-x-auto rounded-lg border bg-card">
              <table className="w-full text-sm">
                <tbody>
                  {rows.map((r) => {
                    const n = counts?.get(`${r.jurisdiction}|${r.code}`) ?? 0
                    const focused = r.jurisdiction === focusJ && r.code === focusC
                    return (
                      <tr
                        key={r.code}
                        ref={focused ? focusRef : undefined}
                        className={`border-b last:border-0 ${focused ? 'bg-blue-50' : ''}`}
                      >
                        <td className="w-28 px-3 py-2 align-top font-mono text-xs font-semibold whitespace-nowrap">
                          {r.code}
                        </td>
                        <td className="px-3 py-2 align-top">
                          {r.description &&
                          r.description.trim().toLowerCase() !== r.code.trim().toLowerCase() ? (
                            r.description
                          ) : (
                            <span className="text-muted-foreground italic">
                              no description published — see the county source
                            </span>
                          )}
                        </td>
                        <td className="w-36 px-3 py-2 align-top whitespace-nowrap">
                          {typeBadge(r)}
                        </td>
                        <td className="w-20 px-3 py-2 align-top whitespace-nowrap">
                          {r.allows_industrial && (
                            <Badge className="border-red-200 bg-red-50 text-red-700" variant="outline">
                              Ind ok
                            </Badge>
                          )}
                        </td>
                        <td className="w-28 px-3 py-2 text-right align-top text-xs whitespace-nowrap text-muted-foreground">
                          {n > 0 ? `${n.toLocaleString()} propert${n === 1 ? 'y' : 'ies'}` : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )
      })}
    </div>
  )
}
