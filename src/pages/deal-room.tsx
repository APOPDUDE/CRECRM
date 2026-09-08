import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import {
  Building2,
  ChevronRight,
  ExternalLink,
  List,
  Mail,
  MapIcon,
  MapPin,
  Phone,
  Ruler,
  X,
} from 'lucide-react'
import { formatPhone } from '@/lib/format'
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

/** Everything an investor taps is at least 44px tall — this is read on a phone. */
const BTN =
  'inline-flex h-12 items-center justify-center gap-2 rounded-lg px-5 text-[15px] font-medium transition-colors'

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap()
  // Framing the map is a side effect, not a computed value — useMemo would run
  // it during render and fight Leaflet's own layout pass.
  useEffect(() => {
    if (points.length === 0) return
    if (points.length === 1) {
      map.setView(points[0], 15)
    } else {
      map.fitBounds(points, { padding: [56, 56], maxZoom: 15 })
    }
  }, [map, points])
  return null
}

function Stat({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 text-lg font-semibold text-slate-900">{value}</div>
    </div>
  )
}

function CompBadge({ c }: { c: DealRoomComp }) {
  const sale = c.deal_type === 'sale'
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-semibold',
        sale ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700',
      )}
    >
      {sale ? 'Sale' : 'Lease'}
    </span>
  )
}

function CompCard({
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
        'w-full rounded-xl border bg-white p-4 text-left transition-shadow hover:shadow-md',
        active ? 'border-blue-500 ring-2 ring-blue-100' : 'border-slate-200',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold text-slate-900">{c.address}</div>
          <div className="mt-0.5 truncate text-sm text-slate-500">
            {[c.city, c.miles != null ? `${c.miles} mi away` : null].filter(Boolean).join(' · ')}
          </div>
        </div>
        <CompBadge c={c} />
      </div>

      <div className="mt-3 text-lg font-bold text-slate-900">{compHeadline(c)}</div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
        {c.sf != null && <span>{num(c.sf)} SF</span>}
        {c.year_built ? <span>Built {c.year_built}</span> : null}
        {compMonth(c.executed_at) && <span>{compMonth(c.executed_at)}</span>}
        {c.tenant_name && <span className="truncate">{c.tenant_name}</span>}
      </div>
      {c.note && <div className="mt-2 text-sm italic text-slate-500">{c.note}</div>}
    </button>
  )
}

/** The slide-in detail for one comp — same panel on both map and list. */
function CompDetail({ c, onClose }: { c: DealRoomComp; onClose: () => void }) {
  const rows: [string, string | null][] = [
    ['Address', [c.address, c.city, c.state].filter(Boolean).join(', ')],
    ['Distance', c.miles != null ? `${c.miles} miles from the subject` : null],
    ['Size', c.sf != null ? `${num(c.sf)} SF` : null],
    ['Year built', c.year_built ? String(c.year_built) : null],
    ['Land', c.land_acres != null ? `${c.land_acres} acres` : null],
    c.deal_type === 'sale'
      ? ['Price', c.sale_price != null ? `$${num(c.sale_price)}` : null]
      : ['Base rent', c.rate_psf != null ? `$${c.rate_psf.toFixed(2)}/SF` : null],
    c.deal_type === 'sale'
      ? ['Price per SF', c.price_psf != null ? `$${c.price_psf.toFixed(2)}` : null]
      : ['Structure', c.lease_structure],
    ['Term', c.term_months != null ? `${c.term_months} months` : null],
    ['Free rent', c.free_rent_months != null ? `${c.free_rent_months} months` : null],
    ['TI', c.ti_psf != null ? `$${c.ti_psf.toFixed(2)}/SF` : null],
    ['Cap rate', c.cap_rate_pct != null ? `${c.cap_rate_pct}%` : null],
    ['Date', compMonth(c.executed_at)],
    ['Tenant', c.tenant_name],
    ['Source', c.kind === 'transfer' ? 'County deed record' : 'Executed transaction'],
  ]

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-5">
        <div className="min-w-0">
          <CompBadge c={c} />
          <h3 className="mt-2 text-xl font-bold text-slate-900">{c.address}</h3>
          <p className="text-sm text-slate-500">{[c.city, c.state, c.zip].filter(Boolean).join(', ')}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        <div className="rounded-xl bg-slate-50 p-4 text-2xl font-bold text-slate-900">
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
          className={cn(BTN, 'mt-5 w-full border border-slate-300 text-slate-700 hover:bg-slate-50')}
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
    ['Land', p.land_acres != null ? `${p.land_acres} acres` : null],
    ['Year built', p.year_built ? String(p.year_built) : null],
    ['Renovated', p.year_renovated ? String(p.year_renovated) : null],
    ['Clear height', p.clear_height_ft != null ? `${p.clear_height_ft} ft` : null],
    ['Dock-high doors', p.dock_high_doors != null ? String(p.dock_high_doors) : null],
    ['Grade-level doors', p.grade_level_doors != null ? String(p.grade_level_doors) : null],
    ['Column spacing', p.column_spacing],
    ['Sprinklers', p.sprinkler_system],
    ['Parking', p.parking_spaces != null ? `${p.parking_spaces} spaces` : null],
    ['Zoning', [p.zoning_district, p.zoning_description].filter(Boolean).join(' — ') || null],
    ['County', p.county],
    ['Parcel', p.parcel_number],
    ['Property type', p.property_type],
  ]
  const shown = facts.filter(([, v]) => v)
  if (shown.length === 0) return null

  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold text-slate-900">Property details</h2>
      <dl className="mt-3 grid grid-cols-1 gap-x-8 sm:grid-cols-2">
        {shown.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 border-b border-slate-100 py-3">
            <dt className="text-sm text-slate-500">{k}</dt>
            <dd className="text-right text-sm font-semibold text-slate-900">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

export function DealRoomPage() {
  const { slug } = useParams<{ slug: string }>()
  const { data, isLoading, isError } = useDealRoom(slug)
  const [view, setView] = useState<'map' | 'list'>('map')
  const [basemap, setBasemap] = useState<keyof typeof BASEMAPS>('street')
  const [filter, setFilter] = useState<'all' | 'lease' | 'sale'>('all')
  const [selected, setSelected] = useState<DealRoomComp | null>(null)

  const comps = useMemo(
    () => (data?.comps ?? []).filter((c) => filter === 'all' || c.deal_type === filter),
    [data?.comps, filter],
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
          <h1 className="mt-4 text-xl font-bold text-slate-900">This link isn’t available</h1>
          <p className="mt-2 text-slate-600">
            It may have expired or been unpublished. Ask whoever shared it for a fresh link.
          </p>
        </div>
      </div>
    )
  }

  const { room, property, stats } = data
  const subjectPsf = room.headline_price_psf
  const vsMarket =
    subjectPsf != null && stats.sale_median_psf != null
      ? Math.round(((subjectPsf - stats.sale_median_psf) / stats.sale_median_psf) * 100)
      : null

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header — the address, the number, and the two things an investor does next. */}
      <header className="sticky top-0 z-[1100] border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-bold text-slate-900 sm:text-2xl">{room.title}</h1>
            {room.subtitle && <p className="truncate text-sm text-slate-500">{room.subtitle}</p>}
          </div>
          <div className="flex items-center gap-2">
            {room.broker_phone && (
              <a href={`tel:${room.broker_phone}`} className={cn(BTN, 'bg-slate-900 text-white hover:bg-slate-800')}>
                <Phone className="h-4 w-4" /> Call
              </a>
            )}
            {room.broker_email && (
              <a
                href={`mailto:${room.broker_email}?subject=${encodeURIComponent(room.title)}`}
                className={cn(BTN, 'bg-blue-600 text-white hover:bg-blue-700')}
              >
                <Mail className="h-4 w-4" /> Request info
              </a>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 pb-24 pt-6">
        {/* Headline numbers */}
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat
            label="Price"
            value={room.headline_price != null ? `$${num(room.headline_price)}` : null}
          />
          <Stat label="Per SF" value={subjectPsf != null ? `$${subjectPsf.toFixed(2)}` : null} />
          <Stat label="Building" value={property.gross_sf != null ? `${num(property.gross_sf)} SF` : null} />
          <Stat
            label="Lease rate"
            value={room.headline_rate_psf != null ? `$${room.headline_rate_psf.toFixed(2)}/SF` : null}
          />
        </section>

        {vsMarket != null && (
          <p className="mt-3 text-sm text-slate-600">
            Asking{' '}
            <span className="font-semibold text-slate-900">${subjectPsf!.toFixed(2)}/SF</span> against a
            comparable sale median of{' '}
            <span className="font-semibold text-slate-900">${stats.sale_median_psf!.toFixed(2)}/SF</span> —{' '}
            <span className={vsMarket <= 0 ? 'font-semibold text-emerald-700' : 'font-semibold text-amber-700'}>
              {vsMarket <= 0 ? `${Math.abs(vsMarket)}% below market` : `${vsMarket}% above market`}
            </span>
            .
          </p>
        )}

        {room.summary && <p className="mt-5 text-[15px] leading-relaxed text-slate-700">{room.summary}</p>}

        {room.highlights.length > 0 && (
          <ul className="mt-5 grid grid-cols-1 gap-y-2 sm:grid-cols-2 sm:gap-x-8">
            {room.highlights.map((h) => (
              <li key={h} className="flex gap-2 text-[15px] text-slate-700">
                <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
                <span>{h}</span>
              </li>
            ))}
          </ul>
        )}

        <a
          href={directionsUrl(property.lat, property.lng, property.address)}
          target="_blank"
          rel="noreferrer"
          className={cn(BTN, 'mt-6 border border-slate-300 bg-white text-slate-700 hover:bg-slate-50')}
        >
          <MapPin className="h-4 w-4" /> Directions <ExternalLink className="h-3.5 w-3.5" />
        </a>

        {/* Comps */}
        <section className="mt-10">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Comparables</h2>
              <p className="text-sm text-slate-500">
                {stats.sale_count} sales · {stats.lease_count} leases
                {stats.sale_median_psf != null && ` · sale median $${stats.sale_median_psf.toFixed(2)}/SF`}
                {stats.lease_median_psf != null && ` · lease median $${stats.lease_median_psf.toFixed(2)}/SF`}
              </p>
            </div>
            <div className="flex rounded-lg border border-slate-300 bg-white p-1">
              {(['map', 'list'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={cn(
                    'inline-flex h-10 items-center gap-2 rounded-md px-4 text-sm font-medium capitalize',
                    view === v ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50',
                  )}
                >
                  {v === 'map' ? <MapIcon className="h-4 w-4" /> : <List className="h-4 w-4" />}
                  {v}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {(
              [
                ['all', `All ${data.comps.length}`],
                ['sale', `Sales ${stats.sale_count}`],
                ['lease', `Leases ${stats.lease_count}`],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setFilter(k)}
                className={cn(
                  'h-11 rounded-full border px-5 text-sm font-medium',
                  filter === k
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {view === 'map' ? (
            <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_380px]">
              <div className="relative h-[560px] overflow-hidden rounded-xl border border-slate-200">
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
                            fillOpacity: 1,
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
                    No mapped comparables
                  </div>
                )}

                <div className="absolute bottom-4 left-4 z-[1000] flex rounded-lg border border-slate-300 bg-white p-1 shadow-sm">
                  {(['street', 'satellite'] as const).map((b) => (
                    <button
                      key={b}
                      type="button"
                      onClick={() => setBasemap(b)}
                      className={cn(
                        'h-10 rounded-md px-4 text-xs font-medium capitalize',
                        basemap === b ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50',
                      )}
                    >
                      {b}
                    </button>
                  ))}
                </div>
              </div>

              <div className="h-[560px] overflow-hidden rounded-xl border border-slate-200 bg-white">
                {selected ? (
                  <CompDetail c={selected} onClose={() => setSelected(null)} />
                ) : (
                  <div className="h-full overflow-y-auto p-3">
                    <div className="px-2 pb-2 pt-1 text-sm text-slate-500">
                      Tap any point on the map, or a card below.
                    </div>
                    <div className="space-y-2">
                      {comps.map((c) => (
                        <CompCard key={c.id} c={c} onClick={() => setSelected(c)} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {comps.map((c) => (
                <CompCard
                  key={c.id}
                  c={c}
                  active={selected?.id === c.id}
                  onClick={() => setSelected(selected?.id === c.id ? null : c)}
                />
              ))}
            </div>
          )}

          {/* On phones the detail opens as a sheet rather than a side panel. */}
          {view === 'list' && selected && (
            <div className="fixed inset-0 z-[1200] flex items-end bg-black/40 sm:items-center sm:justify-center">
              <div className="max-h-[85vh] w-full overflow-hidden rounded-t-2xl sm:max-w-md sm:rounded-2xl">
                <CompDetail c={selected} onClose={() => setSelected(null)} />
              </div>
            </div>
          )}
        </section>

        <PropertyFacts p={property} />

        {(room.broker_name || room.broker_email || room.broker_phone) && (
          <section className="mt-10 rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-bold text-slate-900">Questions?</h2>
            {room.broker_name && <p className="mt-1 text-slate-700">{room.broker_name}</p>}
            <div className="mt-4 flex flex-wrap gap-3">
              {room.broker_phone && (
                <a href={`tel:${room.broker_phone}`} className={cn(BTN, 'bg-slate-900 text-white hover:bg-slate-800')}>
                  <Phone className="h-4 w-4" /> {formatPhone(room.broker_phone)}
                </a>
              )}
              {room.broker_email && (
                <a
                  href={`mailto:${room.broker_email}?subject=${encodeURIComponent(room.title)}`}
                  className={cn(BTN, 'bg-blue-600 text-white hover:bg-blue-700')}
                >
                  <Mail className="h-4 w-4" /> {room.broker_email}
                </a>
              )}
            </div>
          </section>
        )}

        <p className="mt-8 flex items-start gap-2 text-xs leading-relaxed text-slate-400">
          <Ruler className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Comparable data is drawn from county records and market sources and is believed accurate but
          not guaranteed. Figures are approximate and subject to verification. This is not an offer.
        </p>
      </main>
    </div>
  )
}
