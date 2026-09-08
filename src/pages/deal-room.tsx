import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { Building2, ChevronRight, ExternalLink, List, MapIcon, MapPin, X } from 'lucide-react'
import {
  compHeadline,
  compMonth,
  directionsUrl,
  useDealRoom,
  type DealRoomComp,
  type DealRoomPayload,
} from '@/lib/deal-room'
import { cn } from '@/lib/utils'

const SUBJECT = '#1d4ed8'
const LEASE = '#d97706'
const SALE = '#059669'

const BASEMAPS = {
  street: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
  satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
} as const

const num = (n: number | null | undefined) => (n == null ? null : n.toLocaleString('en-US'))

/** Asking rates and executed deals are different evidence — never blend them. */
type Basis = 'executed' | 'asking'
const basisOf = (c: DealRoomComp): Basis => (c.kind === 'asking' ? 'asking' : 'executed')

/** The comparable number for a comp: $/SF sold for a sale, $/SF/yr for a lease. */
function psfOf(c: DealRoomComp): number | null {
  return c.deal_type === 'sale' ? c.price_psf : (c.rate_psf ?? c.asking_psf)
}

function median(values: number[]): number | null {
  const v = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b)
  if (v.length === 0) return null
  const mid = Math.floor(v.length / 2)
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}

function medianOf(comps: DealRoomComp[], deal: 'sale' | 'lease', basis: Basis): number | null {
  return median(
    comps
      .filter((c) => c.deal_type === deal && basisOf(c) === basis)
      .map((c) => psfOf(c))
      .filter((n): n is number => n != null),
  )
}

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap()
  // Framing the map is a side effect, not a computed value — useMemo would run
  // it during render and fight Leaflet's own layout pass.
  useEffect(() => {
    if (points.length === 0) return
    if (points.length === 1) {
      map.setView(points[0], 15)
    } else {
      map.fitBounds(points, { padding: [64, 64], maxZoom: 15 })
    }
  }, [map, points])
  return null
}

function Stat({ label, value, hint }: { label: string; value: string | null; hint?: string | null }) {
  if (!value) return null
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-5 py-4">
      <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </div>
  )
}

function CompBadge({ c }: { c: DealRoomComp }) {
  const sale = c.deal_type === 'sale'
  const asking = basisOf(c) === 'asking'
  return (
    <span className="flex shrink-0 gap-1">
      <span
        className={cn(
          'inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold',
          sale ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700',
        )}
      >
        {sale ? 'Sale' : 'Lease'}
      </span>
      <span
        className={cn(
          'inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold',
          asking ? 'bg-slate-100 text-slate-600' : 'bg-blue-50 text-blue-700',
        )}
      >
        {asking ? 'Asking' : 'Executed'}
      </span>
    </span>
  )
}

/** One dense row — an investor scans twenty of these, so it reads like a rent roll. */
function CompRow({
  c,
  active,
  onClick,
}: {
  c: DealRoomComp
  active?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'grid w-full grid-cols-[1fr_auto] items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors',
        active ? 'border-blue-500 bg-blue-50/40' : 'border-slate-200 bg-white hover:bg-slate-50',
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-slate-900">{c.address}</span>
          <CompBadge c={c} />
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 text-sm text-slate-500">
          {c.sf != null && <span className="tabular-nums">{num(c.sf)} SF</span>}
          {c.year_built ? <span>Built {c.year_built}</span> : null}
          {c.miles != null && <span className="tabular-nums">{c.miles} mi</span>}
          {compMonth(c.executed_at) && <span>{compMonth(c.executed_at)}</span>}
          {c.tenant_name && <span className="truncate">{c.tenant_name}</span>}
        </div>
      </div>
      <div className="text-right">
        <div className="text-lg font-semibold tabular-nums text-slate-900">
          {psfOf(c) != null ? `$${psfOf(c)!.toFixed(2)}` : '—'}
        </div>
        <div className="text-xs text-slate-500">{c.deal_type === 'sale' ? '/SF' : '/SF/yr'}</div>
      </div>
    </button>
  )
}

function CompDetail({ c, onClose }: { c: DealRoomComp; onClose: () => void }) {
  const rows: [string, string | null][] = [
    ['Address', [c.address, c.city, c.state].filter(Boolean).join(', ')],
    ['Distance', c.miles != null ? `${c.miles} miles from the subject` : null],
    ['Size', c.sf != null ? `${num(c.sf)} SF` : null],
    ['Year built', c.year_built ? String(c.year_built) : null],
    ['Land', c.land_acres != null ? `${c.land_acres} acres` : null],
    c.deal_type === 'sale'
      ? ['Price', c.sale_price != null ? `$${num(c.sale_price)}` : null]
      : ['Rate', psfOf(c) != null ? `$${psfOf(c)!.toFixed(2)}/SF` : null],
    c.deal_type === 'sale'
      ? ['Price per SF', c.price_psf != null ? `$${c.price_psf.toFixed(2)}` : null]
      : ['Structure', c.lease_structure],
    ['Term', c.term_months != null ? `${c.term_months} months` : null],
    ['Free rent', c.free_rent_months != null ? `${c.free_rent_months} months` : null],
    ['TI', c.ti_psf != null ? `$${c.ti_psf.toFixed(2)}/SF` : null],
    ['Cap rate', c.cap_rate_pct != null ? `${c.cap_rate_pct}%` : null],
    ['Date', compMonth(c.executed_at)],
    ['Tenant', c.tenant_name],
    [
      'Basis',
      c.kind === 'asking'
        ? 'Asking — currently on the market'
        : c.kind === 'transfer'
          ? 'Executed — county deed record'
          : 'Executed — recorded transaction',
    ],
  ]

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-5">
        <div className="min-w-0">
          <CompBadge c={c} />
          <h3 className="mt-2 text-xl font-semibold text-slate-900">{c.address}</h3>
          <p className="text-sm text-slate-500">{[c.city, c.state, c.zip].filter(Boolean).join(', ')}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        <div className="rounded-lg bg-slate-50 p-4 text-2xl font-semibold tabular-nums text-slate-900">
          {compHeadline(c)}
        </div>
        <dl className="mt-4 divide-y divide-slate-100">
          {rows
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 py-2.5">
                <dt className="text-sm text-slate-500">{k}</dt>
                <dd className="text-right text-sm font-medium text-slate-900">{v}</dd>
              </div>
            ))}
        </dl>
        {c.note && <p className="mt-4 rounded-lg bg-blue-50 p-3 text-sm text-blue-900">{c.note}</p>}
        <a
          href={directionsUrl(c.lat, c.lng, c.address)}
          target="_blank"
          rel="noreferrer"
          className="mt-5 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <MapPin className="h-4 w-4" /> Open in Google Maps
        </a>
      </div>
    </div>
  )
}

function PropertyFacts({ p }: { p: DealRoomPayload['property'] }) {
  const facts: [string, string | null][] = [
    ['Building size', p.gross_sf != null ? `${num(p.gross_sf)} SF` : null],
    ['Heated area', p.heated_sf != null ? `${num(p.heated_sf)} SF` : null],
    ['Land', p.land_acres != null ? `${p.land_acres} acres` : null],
    ['Year built', p.year_built ? String(p.year_built) : null],
    ['Renovated', p.year_renovated ? String(p.year_renovated) : null],
    ['Building class', p.building_class],
    ['Clear height', p.clear_height_ft != null ? `${p.clear_height_ft} ft` : null],
    ['Dock-high doors', p.dock_high_doors != null ? String(p.dock_high_doors) : null],
    ['Grade-level doors', p.grade_level_doors != null ? String(p.grade_level_doors) : null],
    ['Column spacing', p.column_spacing],
    ['Sprinklers', p.sprinkler_system],
    ['Parking', p.parking_spaces != null ? `${p.parking_spaces} spaces` : null],
    ['Zoning', [p.zoning_district, p.zoning_description].filter(Boolean).join(' — ') || null],
    ['County', p.county],
    ['Parcel', p.parcel_number],
    ['County just value', p.just_value != null ? `$${num(p.just_value)}` : null],
  ]
  const shown = facts.filter(([, v]) => v)
  if (shown.length === 0) return null

  return (
    <section className="mt-10">
      <h2 className="text-base font-semibold text-slate-900">Property details</h2>
      <dl className="mt-3 grid grid-cols-1 gap-x-10 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {shown.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 border-b border-slate-100 py-2.5">
            <dt className="text-sm text-slate-500">{k}</dt>
            <dd className="text-right text-sm font-medium tabular-nums text-slate-900">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/** Segmented control — one visual language for both toggles. */
function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string; icon?: React.ReactNode }[]
}) {
  return (
    <div className="flex rounded-lg border border-slate-300 bg-white p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'inline-flex h-9 items-center gap-1.5 rounded-md px-4 text-sm font-medium transition-colors',
            value === o.value ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50',
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function DealRoomPage() {
  const { slug } = useParams<{ slug: string }>()
  const { data, isLoading, isError } = useDealRoom(slug)
  const [view, setView] = useState<'map' | 'list'>('map')
  const [basemap, setBasemap] = useState<keyof typeof BASEMAPS>('street')
  const [basis, setBasis] = useState<Basis>('executed')
  const [deal, setDeal] = useState<'all' | 'sale' | 'lease'>('all')
  const [selected, setSelected] = useState<DealRoomComp | null>(null)

  const all = useMemo(() => data?.comps ?? [], [data?.comps])

  const comps = useMemo(
    () => all.filter((c) => basisOf(c) === basis && (deal === 'all' || c.deal_type === deal)),
    [all, basis, deal],
  )

  const counts = useMemo(
    () => ({
      sale: all.filter((c) => basisOf(c) === basis && c.deal_type === 'sale').length,
      lease: all.filter((c) => basisOf(c) === basis && c.deal_type === 'lease').length,
      executed: all.filter((c) => basisOf(c) === 'executed').length,
      asking: all.filter((c) => basisOf(c) === 'asking').length,
    }),
    [all, basis],
  )

  const medians = useMemo(
    () => ({
      saleExecuted: medianOf(all, 'sale', 'executed'),
      saleAsking: medianOf(all, 'sale', 'asking'),
      leaseExecuted: medianOf(all, 'lease', 'executed'),
      leaseAsking: medianOf(all, 'lease', 'asking'),
    }),
    [all],
  )

  const subjectLat = data?.property.lat ?? null
  const subjectLng = data?.property.lng ?? null
  const points = useMemo(() => {
    const pts: [number, number][] = []
    if (subjectLat != null && subjectLng != null) pts.push([subjectLat, subjectLng])
    for (const c of comps) if (c.lat != null && c.lng != null) pts.push([c.lat, c.lng])
    return pts
  }, [subjectLat, subjectLng, comps])

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="text-slate-500">Loading…</div>
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
        <div className="max-w-md text-center">
          <Building2 className="mx-auto h-10 w-10 text-slate-300" />
          <h1 className="mt-4 text-xl font-semibold text-slate-900">This link isn’t available</h1>
          <p className="mt-2 text-slate-600">
            It may have expired or been unpublished. Ask whoever shared it for a fresh link.
          </p>
        </div>
      </div>
    )
  }

  const { room, property } = data
  const subjectPsf = room.headline_price_psf
  const vsMarket =
    subjectPsf != null && medians.saleExecuted != null
      ? Math.round(((subjectPsf - medians.saleExecuted) / medians.saleExecuted) * 100)
      : null

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-[1100] border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-baseline gap-x-4 gap-y-1 px-6 py-4 xl:px-10">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{room.title}</h1>
          {room.subtitle && <p className="text-sm text-slate-500">{room.subtitle}</p>}
          <a
            href={directionsUrl(property.lat, property.lng, property.address)}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <MapPin className="h-4 w-4" /> Directions <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-[1800px] px-6 pb-20 pt-6 xl:px-10">
        {/* Headline numbers, with the market read sitting next to the ask. */}
        <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Stat label="Price" value={room.headline_price != null ? `$${num(room.headline_price)}` : null} />
          <Stat label="Price / SF" value={subjectPsf != null ? `$${subjectPsf.toFixed(2)}` : null} />
          <Stat
            label="Lease ask"
            value={room.headline_rate_psf != null ? `$${room.headline_rate_psf.toFixed(2)}` : null}
            hint="per SF / yr"
          />
          <Stat label="Building" value={property.gross_sf != null ? `${num(property.gross_sf)} SF` : null} />
          <Stat
            label="Sale comps"
            value={medians.saleExecuted != null ? `$${medians.saleExecuted.toFixed(2)}` : null}
            hint={`executed median · ${counts.executed ? all.filter((c) => c.deal_type === 'sale' && basisOf(c) === 'executed').length : 0} comps`}
          />
          <Stat
            label="Lease comps"
            value={medians.leaseExecuted != null ? `$${medians.leaseExecuted.toFixed(2)}` : null}
            hint={`executed median · ${all.filter((c) => c.deal_type === 'lease' && basisOf(c) === 'executed').length} comps`}
          />
        </section>

        {vsMarket != null && (
          <p className="mt-4 text-[15px] text-slate-700">
            Asking <span className="font-semibold tabular-nums">${subjectPsf!.toFixed(2)}/SF</span> against an
            executed sale median of{' '}
            <span className="font-semibold tabular-nums">${medians.saleExecuted!.toFixed(2)}/SF</span> —{' '}
            <span className={vsMarket <= 0 ? 'font-semibold text-emerald-700' : 'font-semibold text-amber-700'}>
              {vsMarket <= 0 ? `${Math.abs(vsMarket)}% below market` : `${vsMarket}% above market`}
            </span>
            {medians.saleAsking != null && (
              <>
                {' '}
                · other sellers are asking a median of{' '}
                <span className="font-semibold tabular-nums">${medians.saleAsking.toFixed(2)}/SF</span>
              </>
            )}
            .
          </p>
        )}

        {/* Narrative and highlights sit side by side once there's width for it. */}
        <div className="mt-6 grid gap-8 xl:grid-cols-2">
          {room.summary && (
            <p className="text-[15px] leading-relaxed text-slate-700">{room.summary}</p>
          )}
          {room.highlights.length > 0 && (
            <ul className="grid grid-cols-1 gap-y-1.5 sm:grid-cols-2 sm:gap-x-8 xl:grid-cols-1 2xl:grid-cols-2">
              {room.highlights.map((h) => (
                <li key={h} className="flex gap-2 text-[15px] text-slate-700">
                  <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-blue-600" />
                  <span>{h}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <section className="mt-10">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Comparables</h2>
              <p className="mt-1 text-sm text-slate-500">
                Showing <span className="font-medium text-slate-700">{comps.length}</span>{' '}
                {basis === 'asking' ? 'asking' : 'executed'} comps
                {deal !== 'all' && ` · ${deal === 'sale' ? 'sales' : 'leases'}`}
                {(() => {
                  const m =
                    deal === 'lease'
                      ? basis === 'asking'
                        ? medians.leaseAsking
                        : medians.leaseExecuted
                      : deal === 'sale'
                        ? basis === 'asking'
                          ? medians.saleAsking
                          : medians.saleExecuted
                        : null
                  return m != null ? ` · median $${m.toFixed(2)}/SF` : ''
                })()}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Segmented
                value={basis}
                onChange={(v) => {
                  setBasis(v)
                  setSelected(null)
                }}
                options={[
                  { value: 'executed', label: `Executed ${counts.executed}` },
                  { value: 'asking', label: `Asking ${counts.asking}` },
                ]}
              />
              <Segmented
                value={deal}
                onChange={(v) => {
                  setDeal(v)
                  setSelected(null)
                }}
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'sale', label: `Sales ${counts.sale}` },
                  { value: 'lease', label: `Leases ${counts.lease}` },
                ]}
              />
              <Segmented
                value={view}
                onChange={setView}
                options={[
                  { value: 'map', label: 'Map', icon: <MapIcon className="h-4 w-4" /> },
                  { value: 'list', label: 'List', icon: <List className="h-4 w-4" /> },
                ]}
              />
            </div>
          </div>

          {basis === 'asking' && (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
              Asking rates are what owners are currently marketing — not what deals traded at. Compare
              them against the executed set, never blended with it.
            </p>
          )}

          {view === 'map' ? (
            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px] 2xl:grid-cols-[minmax(0,1fr)_520px]">
              <div className="relative h-[600px] overflow-hidden rounded-xl border border-slate-200 xl:h-[calc(100vh-260px)] xl:min-h-[640px]">
                {points.length > 0 ? (
                  <MapContainer
                    center={points[0]}
                    zoom={14}
                    scrollWheelZoom
                    className="h-full w-full"
                    attributionControl={false}
                  >
                    <TileLayer url={BASEMAPS[basemap]} maxZoom={19} />
                    <FitBounds points={points} />

                    {property.lat != null && property.lng != null && (
                      <CircleMarker
                        center={[property.lat, property.lng]}
                        radius={14}
                        pathOptions={{ color: '#fff', weight: 3, fillColor: SUBJECT, fillOpacity: 1 }}
                      >
                        <Tooltip direction="top" offset={[0, -12]} permanent>
                          <span className="font-semibold">{property.address}</span>
                        </Tooltip>
                      </CircleMarker>
                    )}

                    {comps.map((c) =>
                      c.lat != null && c.lng != null ? (
                        <CircleMarker
                          key={c.id}
                          center={[c.lat, c.lng]}
                          radius={selected?.id === c.id ? 13 : 9}
                          pathOptions={{
                            color: '#fff',
                            weight: 2,
                            fillColor: c.deal_type === 'sale' ? SALE : LEASE,
                            fillOpacity: basisOf(c) === 'asking' ? 0.55 : 1,
                          }}
                          eventHandlers={{ click: () => setSelected(c) }}
                        >
                          <Tooltip direction="top" offset={[0, -8]}>
                            <div className="text-xs">
                              <div className="font-semibold">{c.address}</div>
                              <div>{compHeadline(c)}</div>
                              <div className="text-slate-500">
                                {[c.sf != null ? `${num(c.sf)} SF` : null, compMonth(c.executed_at)]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </div>
                            </div>
                          </Tooltip>
                        </CircleMarker>
                      ) : null,
                    )}
                  </MapContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-slate-400">
                    No mapped comparables in this view
                  </div>
                )}

                <div className="absolute bottom-4 left-4 z-[1000] flex rounded-lg border border-slate-300 bg-white p-1 shadow-sm">
                  {(['street', 'satellite'] as const).map((b) => (
                    <button
                      key={b}
                      type="button"
                      onClick={() => setBasemap(b)}
                      className={cn(
                        'h-8 rounded-md px-3 text-xs font-medium capitalize',
                        basemap === b ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50',
                      )}
                    >
                      {b}
                    </button>
                  ))}
                </div>

                <div className="absolute bottom-4 right-4 z-[1000] flex flex-col gap-1 rounded-lg border border-slate-300 bg-white/95 p-3 text-xs shadow-sm">
                  {[
                    ['Subject', SUBJECT],
                    ['Sale', SALE],
                    ['Lease', LEASE],
                  ].map(([label, color]) => (
                    <span key={label} className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: color as string }}
                      />
                      {label}
                    </span>
                  ))}
                </div>
              </div>

              <div className="h-[600px] overflow-hidden rounded-xl border border-slate-200 bg-white xl:h-[calc(100vh-260px)] xl:min-h-[640px]">
                {selected ? (
                  <CompDetail c={selected} onClose={() => setSelected(null)} />
                ) : (
                  <div className="h-full overflow-y-auto p-3">
                    <div className="px-2 pb-2 pt-1 text-sm text-slate-500">
                      Select a point on the map, or a row here.
                    </div>
                    <div className="space-y-1.5">
                      {comps.map((c) => (
                        <CompRow key={c.id} c={c} onClick={() => setSelected(c)} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-4 grid gap-2 xl:grid-cols-2">
              {comps.map((c) => (
                <CompRow
                  key={c.id}
                  c={c}
                  active={selected?.id === c.id}
                  onClick={() => setSelected(selected?.id === c.id ? null : c)}
                />
              ))}
            </div>
          )}

          {view === 'list' && selected && (
            <div
              className="fixed inset-0 z-[1200] flex items-end bg-black/40 sm:items-center sm:justify-center"
              onClick={() => setSelected(null)}
            >
              <div
                className="max-h-[85vh] w-full overflow-hidden rounded-t-2xl sm:max-w-lg sm:rounded-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <CompDetail c={selected} onClose={() => setSelected(null)} />
              </div>
            </div>
          )}
        </section>

        <PropertyFacts p={property} />

        <p className="mt-10 border-t border-slate-200 pt-5 text-xs leading-relaxed text-slate-400">
          Comparable data is drawn from county records and market sources and is believed accurate but
          not guaranteed. Figures are approximate and subject to verification. This is not an offer.
        </p>
      </main>
    </div>
  )
}
