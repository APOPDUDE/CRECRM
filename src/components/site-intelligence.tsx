import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useParcelEnrichment } from '@/hooks/use-parcel-enrichment'

/**
 * Site intelligence — the enrichment pipeline's answers about one parcel.
 *
 * Every distance in parcel_enrichment is capped and writes its CAP rather than
 * null when nothing is found, so "measured, and the answer is far" stays
 * distinct from "never looked". This card has to preserve that distinction or
 * the whole convention is wasted: at the cap it prints "none within 10 mi",
 * and a missing value prints nothing at all.
 */

const NUM = new Intl.NumberFormat('en-US')

/** Distance sentinels, in the units the column stores. */
const CAP_FT_10MI = 52800
const CAP_FT_1MI = 5280
const CAP_MI_25 = 25

function ft(v: number | null, cap?: number, capLabel?: string) {
  if (v === null || v === undefined) return null
  if (cap !== undefined && v >= cap) return capLabel ?? `over ${NUM.format(cap)} ft`
  if (v >= 5280) return `${(v / 5280).toFixed(1)} mi`
  return `${NUM.format(Math.round(v))} ft`
}

function mi(v: number | null, cap?: number, capLabel?: string) {
  if (v === null || v === undefined) return null
  if (cap !== undefined && v >= cap) return capLabel ?? `over ${cap} mi`
  return `${Number(v).toFixed(2)} mi`
}

type EasementItem = { label?: string; ref?: string; own?: string; sub?: string; j?: string }

/** The instruments on the parcel, easements first, then right-of-way and vacated context. */
function easementRows(v: unknown): { label: string; value: string; note?: string }[] {
  if (!Array.isArray(v)) return []
  const rank = (e: EasementItem) => (e.sub === 'easement' ? 0 : e.sub === 'row' ? 1 : 2)
  return (v as EasementItem[])
    .slice()
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, 6)
    .map((e) => ({
      label: e.sub === 'row' ? 'Right of way' : e.sub === 'vacated' ? 'Vacated' : e.label || 'Easement',
      value: e.ref || e.own || e.j || '—',
      note: e.ref && e.own ? e.own : undefined,
    }))
}

function Row({ label, value, note }: { label: string; value: string | null; note?: string }) {
  if (!value) return null
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-right text-sm tabular-nums">
        {value}
        {note && <span className="ml-1 text-xs text-muted-foreground">{note}</span>}
      </span>
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  const has = Array.isArray(children) ? children.some(Boolean) : !!children
  if (!has) return null
  return (
    <div className="min-w-0 space-y-0.5">
      <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground/70">{title}</h4>
      <div className="divide-y">{children}</div>
    </div>
  )
}

export function SiteIntelligence({ propertyId }: { propertyId: string }) {
  const { data, isLoading } = useParcelEnrichment(propertyId)
  if (isLoading || !data) return null

  const breakdown = (data.score_breakdown ?? {}) as {
    coverage?: number
    min_coverage?: number
    killed?: boolean
  }
  const coverage = typeof breakdown.coverage === 'number' ? breakdown.coverage : null
  const score = data.suitability_score

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Site intelligence</h3>
        {score !== null ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant={Number(score) >= 70 ? 'default' : 'secondary'}>
                {Number(score).toFixed(0)} / 100
                {coverage !== null && (
                  <span className="ml-1 font-normal opacity-70">
                    · {Math.round(coverage * 100)}% measured
                  </span>
                )}
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-72">
              Developer suitability, weighted by enrichment_score_weights and normalized over
              the factors actually measured. {breakdown.killed && 'Zeroed by a dealbreaker '}
              Change the weights in the database, not here.
            </TooltipContent>
          </Tooltip>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="font-normal">
                Score withheld
                {coverage !== null && ` · ${Math.round(coverage * 100)}% measured`}
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-72">
              Too few factors measured to score honestly (floor is{' '}
              {Math.round((breakdown.min_coverage ?? 0.25) * 100)}%). The numbers below are
              still real — the composite is not.
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Group title="Power">
          <Row label="Serving utility" value={data.electric_provider} />
          <Row
            label="Nearest substation"
            value={ft(data.substation_dist_ft, CAP_FT_10MI, 'none within 10 mi')}
          />
          <Row
            label="Transmission line"
            value={ft(data.transmission_line_dist_ft, CAP_FT_10MI, 'none within 10 mi')}
            note={data.transmission_kv ? `${data.transmission_kv} kV` : undefined}
          />
          <Row
            label="Nearest building"
            value={ft(data.nearest_powered_parcel_ft, CAP_FT_1MI, 'none within 1 mi')}
          />
        </Group>

        <Group title="Gas">
          <Row
            label="Transmission line"
            value={ft(data.gas_transmission_dist_ft, CAP_FT_10MI, 'none within 10 mi')}
          />
          <Row label="Operator" value={data.gas_operator} />
        </Group>

        <Group title="Water and sewer">
          <Row
            label="Water main"
            value={ft(data.water_main_dist_ft, CAP_FT_1MI, 'none within 1 mi')}
            note={data.water_main_diameter_in ? `${Number(data.water_main_diameter_in)}"` : undefined}
          />
          <Row label="Gravity sewer" value={ft(data.sewer_gravity_dist_ft, CAP_FT_1MI, 'none within 1 mi')} />
          <Row label="Force main" value={ft(data.sewer_force_dist_ft, CAP_FT_1MI, 'none within 1 mi')} />
          <Row label="Water provider" value={data.water_provider} />
          <Row label="Sewer provider" value={data.sewer_provider} />
          <Row
            label="Service area"
            value={
              data.in_water_service_area === null && data.in_sewer_service_area === null
                ? null
                : [data.in_water_service_area && 'water', data.in_sewer_service_area && 'sewer']
                    .filter(Boolean)
                    .join(' + ') || 'outside both'
            }
          />
        </Group>

        <Group title="Access">
          <Row
            label="Interstate interchange"
            value={mi(data.interchange_mi, CAP_MI_25, 'over 25 mi')}
          />
          <Row label="CSX line" value={mi(data.csx_mainline_mi, CAP_MI_25, 'over 25 mi')} />
          <Row
            label="Fronting road AADT"
            value={data.frontage_aadt === null ? null : NUM.format(data.frontage_aadt)}
            note={data.on_truck_route ? 'truck route' : undefined}
          />
          <Row label="Road frontage" value={ft(data.road_frontage_ft)} />
        </Group>

        <Group title="Shape">
          <Row
            label="Depth × width"
            value={
              data.parcel_depth_ft && data.parcel_width_ft
                ? `${NUM.format(Math.round(Number(data.parcel_depth_ft)))} × ${NUM.format(
                    Math.round(Number(data.parcel_width_ft)),
                  )} ft`
                : null
            }
          />
          <Row
            label="Rectangularity"
            value={data.rectangularity === null ? null : Number(data.rectangularity).toFixed(2)}
          />
        </Group>

        <Group title="Recorded easements">
          <Row
            label="On this parcel"
            value={
              data.easement_count === null
                ? null
                : data.easement_count === 0
                  ? 'none plotted'
                  : `${data.easement_count}`
            }
            note={
              data.easement_pct != null && Number(data.easement_pct) > 0
                ? `${Number(data.easement_pct).toFixed(0)}% of area`
                : undefined
            }
          />
          {easementRows(data.easements).map((e, i) => (
            <Row key={i} label={e.label} value={e.value} note={e.note} />
          ))}
        </Group>

        <Group title="Constraints">
          <Row label="FEMA zone" value={data.fema_flood_zone} />
          <Row
            label="In flood zone"
            value={data.pct_sfha === null ? null : `${Number(data.pct_sfha).toFixed(0)}% of parcel`}
          />
          <Row
            label="Wetlands"
            value={
              data.wetlands_pct === null ? null : `${Number(data.wetlands_pct).toFixed(0)}% of parcel`
            }
          />
          <Row
            label="Hydric soils"
            value={
              data.hydric_soils_pct === null
                ? null
                : `${Number(data.hydric_soils_pct).toFixed(0)}% of parcel`
            }
          />
          <Row
            label="Mean slope"
            value={data.slope_mean_pct === null ? null : `${Number(data.slope_mean_pct).toFixed(1)}%`}
          />
        </Group>
      </div>

      <p className="text-xs text-muted-foreground">
        Proximity from public GIS (HIFLD, EIA, FDOT, FEMA, NWI, county utility and recorder maps).
        A short distance to a main or a substation is a reason to make the call, never a
        will-serve; a plotted easement is a reason to pull the instrument, never a title opinion.
      </p>
    </section>
  )
}
