/**
 * The map layers beyond zoning (2026-09-02, modelled on Paxiv's Overlays + Basemap
 * panels): utilities, recorded easements, and historical imagery.
 *
 * Utilities and easements are served from OUR cache (gis.layer_features, filled by
 * the harvest-gis edge function) through the map_layer_features() RPC — one origin,
 * one style, and the very rows the per-parcel numbers in parcel_enrichment are
 * measured from, so "water main 210 ft" on the property page and the blue line on the
 * map can never disagree. Imagery is tiles straight from the publishers (Esri
 * Wayback, county aerials, SWFWMD), because tiles are what those servers exist for.
 */

export type UtilityLayerId = 'water' | 'sewer' | 'electric' | 'gas' | 'rail' | 'flood' | 'wetlands'

export type UtilityLayer = {
  id: UtilityLayerId
  /** the rail's heading: what is in the ground vs what the ground is */
  group: 'infrastructure' | 'environment'
  label: string
  color: string
  /** the map_layer_features kinds this switch turns on */
  kinds: string[]
  /** below this zoom the layer is not requested — Tampa holds ~1,200 main segments per
   * km² (valve to valve), so mains wait for zoom 16 (a few blocks, ~500 segments) or the
   * answer is megabytes of noise */
  minZoom: number
  /** a kind inside the layer that needs a closer camera than the layer itself (crossings) */
  kindMinZoom?: Record<string, number>
  /** who publishes it — the honest coverage note next to the checkbox */
  hint: string
}

export const WATER_COLOR = '#2563eb'
export const SEWER_COLOR = '#db2777'
export const ELECTRIC_COLOR = '#f59e0b'
export const GAS_COLOR = '#7c3aed'
export const RAIL_COLOR = '#1f2937'
export const FLOOD_COLOR = '#2563eb'
export const FLOOD_02_COLOR = '#f59e0b'
export const FLOODWAY_COLOR = '#1e3a8a'
export const COASTAL_COLOR = '#7e22ce'
export const WETLAND_COLOR = '#15803d'
export const WETLAND_WATER_COLOR = '#0891b2'
export const EASEMENT_COLOR = '#ea580c'
/** public right-of-way strips in the same inventory as the easements — context, not encumbrance */
export const ROW_COLOR = '#64748b'

// The water/sewer SERVICE-AREA polygons are deliberately not a rail toggle (Alex
// 2026-09-02: redundant next to the mains themselves). They still feed the property
// page — in_water_service_area / provider — and the RPC still serves the kinds.
export const UTILITY_LAYERS: UtilityLayer[] = [
  {
    id: 'water',
    group: 'infrastructure',
    label: 'Water mains',
    color: WATER_COLOR,
    kinds: ['water_main'],
    minZoom: 16,
    hint: 'Hillsborough, Tampa, Sarasota, Manatee · width follows pipe diameter',
  },
  {
    id: 'sewer',
    group: 'infrastructure',
    label: 'Sewer mains',
    color: SEWER_COLOR,
    kinds: ['sewer_gravity', 'sewer_force'],
    minZoom: 16,
    hint: 'gravity solid, force main dashed · + Pinellas force mains',
  },
  {
    id: 'electric',
    group: 'infrastructure',
    label: 'Electric transmission + substations',
    color: ELECTRIC_COLOR,
    kinds: ['electric_transmission', 'electric_substation'],
    minZoom: 9,
    hint: 'HIFLD, in-service only · width follows kV',
  },
  {
    id: 'gas',
    group: 'infrastructure',
    label: 'Gas transmission',
    color: GAS_COLOR,
    kinds: ['gas_transmission'],
    minZoom: 9,
    hint: 'EIA/HIFLD interstate + intrastate lines',
  },
  {
    id: 'rail',
    group: 'infrastructure',
    label: 'Railroads',
    color: RAIL_COLOR,
    kinds: ['rail_line', 'rail_crossing'],
    minZoom: 9,
    kindMinZoom: { rail_crossing: 13 },
    hint: 'FRA network: owner, subdivision, main / industrial lead / yard / abandoned, tracks · crossings carry trains per day · click any of it for what the terms mean',
  },
  // ---- the ground itself. Both were already in the cache for the property-page numbers
  // (fema_flood_zone / pct_sfha, wetlands_pct), so the map paints the SAME polygons the
  // numbers were measured from. Neither paints at county zoom: NFHL panels and NWI
  // photo-interpretation are parcel-scale products, and at 1:500k NWI reads as "half of
  // inland Florida is swamp" (Alex 2026-08-16: "cover sucks").
  {
    id: 'flood',
    group: 'environment',
    label: 'Flood zones (FEMA)',
    color: FLOOD_COLOR,
    kinds: ['flood_zone'],
    minZoom: 12,
    hint: '1% annual chance (A/AE/AH/AO) blue, coastal VE purple, floodway navy, 0.2% (shaded X) amber · unshaded X not painted',
  },
  {
    id: 'wetlands',
    group: 'environment',
    label: 'Wetlands (NWI)',
    color: WETLAND_COLOR,
    kinds: ['wetland'],
    minZoom: 12,
    hint: 'USFWS National Wetlands Inventory · a desktop screen, not a delineation — jurisdictional limits need a field survey',
  },
]

export const EASEMENT_LAYER = {
  color: EASEMENT_COLOR,
  kinds: ['easement'],
  minZoom: 15,
  hint: 'Hillsborough PA, Pasco PA, Pinellas, St. Pete, Lakeland, Manatee + FDEP conservation easements',
}

// ---------------------------------------------------------------------------
// Reference overlays (2026-09-03, Alex: "street names, city outlines, county
// outlines and stuff"): the labels a satellite basemap lacks. Streets are Esri's
// World Transportation reference tiles — the layer Esri itself draws over World
// Imagery, so roads, street names and highway shields register with the aerials
// tile for tile. City limits and county lines are Census TIGERweb polygons (the
// legal boundaries, generalized to ~50 m) drawn by us, so they can carry their own
// names and a style that reads through the zoning fills.

export type ReferenceLayerId = 'streets' | 'cities' | 'counties'

export type ReferenceLayer = {
  id: ReferenceLayerId
  label: string
  color: string
  hint: string
}

export const CITY_LINE_COLOR = '#f8fafc'
export const COUNTY_LINE_COLOR = '#facc15'

export const REFERENCE_LAYERS: ReferenceLayer[] = [
  { id: 'streets', label: 'Streets + road names', color: '#e2e8f0', hint: 'Esri reference tiles · names from about zoom 14' },
  { id: 'cities', label: 'City limits', color: CITY_LINE_COLOR, hint: 'Census TIGER municipal boundaries · names from zoom 10' },
  { id: 'counties', label: 'County lines', color: COUNTY_LINE_COLOR, hint: 'Census TIGER county boundaries, all of Florida' },
]

export const STREETS_TILE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}'

const TIGERWEB = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb'
/** Florida's 67 counties — small enough to take whole; the book's neighbours matter at county zoom. */
export const COUNTY_LINES_URL =
  `${TIGERWEB}/State_County/MapServer/1/query?where=STATE%3D%2712%27&outFields=NAME,GEOID&f=geojson&outSR=4326&geometryPrecision=4&maxAllowableOffset=0.002`
/** Incorporated places touching the six-county book (SWFWMD's district box) — ~100 cities, ~0.5 MB. */
export const CITY_LIMITS_URL =
  `${TIGERWEB}/Places_CouSub_ConCity_SubMCD/MapServer/4/query?where=STATE%3D%2712%27&geometry=-83.05,26.9,-81.05,28.55&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=NAME,GEOID&f=geojson&outSR=4326&geometryPrecision=4&maxAllowableOffset=0.0005`

/** The lowest zoom at which every requested kind is allowed — the RPC is not asked below it. */
export function utilityKindsForZoom(
  utilities: Partial<Record<UtilityLayerId, boolean>>,
  easements: boolean,
  zoom: number,
): { kinds: string[]; waiting: string[] } {
  const kinds: string[] = []
  const waiting: string[] = []
  for (const l of UTILITY_LAYERS) {
    if (!utilities[l.id]) continue
    if (zoom < l.minZoom) {
      waiting.push(l.label)
      continue
    }
    for (const k of l.kinds) {
      if (zoom >= (l.kindMinZoom?.[k] ?? l.minZoom)) kinds.push(k)
    }
  }
  if (easements) {
    if (zoom >= EASEMENT_LAYER.minZoom) kinds.push(...EASEMENT_LAYER.kinds)
    else waiting.push('Easements')
  }
  return { kinds, waiting }
}

// ---------------------------------------------------------------------------
// Historical imagery — Paxiv's Basemap › Historical year slider IS Esri's World
// Imagery Wayback (its archive starts 2014). We add what the counties keep that
// reaches further back: Pinellas 1980 →, Hillsborough 1938 + 2013 →, SWFWMD's
// district-wide flights. Each source carries its own bounds, so the layer for a year
// is a STACK — Wayback (where it exists) with the sharper local flight on top.

export type ImagerySource = {
  key: string
  year: number
  /** who flew it — shown next to the year */
  source: string
  /** 'xyz' = a real tile cache; 'export' = one dynamic ArcGIS image per tile (slower, always works) */
  kind: 'xyz' | 'export'
  url: string
  /** [[south, west], [north, east]] — tiles are only requested inside it */
  bounds?: [[number, number], [number, number]]
  maxNativeZoom: number
}

const WAYBACK =
  'https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile'
/** One release per year — the last one flown that year (waybackconfig.json, read 2026-09-02). */
const WAYBACK_RELEASES: Record<number, number> = {
  2014: 5844,
  2015: 28163,
  2016: 18966,
  2017: 25521,
  2018: 23448,
  2019: 4756,
  2020: 29260,
  2021: 26120,
  2022: 45134,
  2023: 56102,
  2024: 16453,
  2025: 13192,
  2026: 26334,
}

const HC_BOUNDS: ImagerySource['bounds'] = [
  [27.57, -82.65],
  [28.2, -82.05],
]
const PINELLAS_BOUNDS: ImagerySource['bounds'] = [
  [27.6, -82.9],
  [28.2, -82.55],
]
/** SWFWMD's district covers all six counties of the book. */
const SWFWMD_BOUNDS: ImagerySource['bounds'] = [
  [26.9, -83.05],
  [28.55, -81.05],
]

const HC = 'https://maps.hillsboroughcounty.org/arcgis/rest/services/'
const PIN = 'https://egis.pinellas.gov/gis/rest/services/'
const SWF = 'https://www25.swfwmd.state.fl.us/arcgis12/rest/services/Imagery/'

export const IMAGERY_SOURCES: ImagerySource[] = [
  ...Object.entries(WAYBACK_RELEASES).map(([y, r]) => ({
    key: `wayback-${y}`,
    year: Number(y),
    source: 'Esri Wayback',
    kind: 'xyz' as const,
    url: `${WAYBACK}/${r}/{z}/{y}/{x}`,
    maxNativeZoom: 19,
  })),
  // Hillsborough: the tile caches serve 2018 and 2022 →; the older flights only
  // answer exportImage (checked 2026-09-02).
  ...[2018, 2022, 2023, 2024, 2025].map((y) => ({
    key: `hc-${y}`,
    year: y,
    source: 'Hillsborough County',
    kind: 'xyz' as const,
    url: `${HC}AerialsNew/Aerials_${y}/ImageServer/tile/{z}/{y}/{x}`,
    bounds: HC_BOUNDS,
    maxNativeZoom: 20,
  })),
  ...[2013, 2014, 2016, 2017].map((y) => ({
    key: `hc-${y}`,
    year: y,
    source: 'Hillsborough County',
    kind: 'export' as const,
    url: `${HC}AerialsNew/Aerials_${y}/ImageServer/exportImage`,
    bounds: HC_BOUNDS,
    maxNativeZoom: 19,
  })),
  {
    key: 'hc-1938',
    year: 1938,
    source: 'Hillsborough County',
    kind: 'export',
    url: `${HC}Aerials/HC_Aerials1938_WGS/ImageServer/exportImage`,
    bounds: HC_BOUNDS,
    maxNativeZoom: 17,
  },
  // Pinellas keeps a tile cache per flight back to 1980 (2017 and 2024 are missing
  // from the server, checked 2026-09-02).
  ...[
    1980, 1984, 1990, 1994, 1997, 2002, 2004, 2005, 2006, 2008, 2009, 2010, 2011, 2014, 2016,
    2018, 2019, 2020, 2021, 2022, 2023,
  ].map((y) => ({
    key: `pin-${y}`,
    year: y,
    source: 'Pinellas County',
    kind: 'xyz' as const,
    url: `${PIN}Aerials/Aerials${y}/ImageServer/tile/{z}/{y}/{x}`,
    bounds: PINELLAS_BOUNDS,
    maxNativeZoom: y >= 2016 ? 20 : 19,
  })),
  ...[2025, 2026].map((y) => ({
    key: `pin-${y}`,
    year: y,
    source: 'Pinellas County',
    kind: 'xyz' as const,
    url: `${PIN}Aerials${y}/ImageServer/tile/{z}/{y}/{x}`,
    bounds: PINELLAS_BOUNDS,
    maxNativeZoom: 20,
  })),
  ...[2014, 2017, 2020, 2023].map((y) => ({
    key: `swfwmd-${y}`,
    year: y,
    source: 'SWFWMD',
    kind: 'export' as const,
    url: `${SWF}Imagery_${y}_NC/MapServer/export`,
    bounds: SWFWMD_BOUNDS,
    maxNativeZoom: 19,
  })),
]

/** Every year something was flown, oldest first — the slider's ticks. */
export const IMAGERY_YEARS: number[] = [...new Set(IMAGERY_SOURCES.map((s) => s.year))].sort((a, b) => a - b)

/**
 * The layers to stack for one year, bottom first: Wayback (nationwide) underneath,
 * SWFWMD's district flight over it, the county's own flight on top — each only
 * inside its bounds, so the sharpest imagery available wins wherever it exists.
 */
export function imageryStack(year: number): ImagerySource[] {
  const rank = (s: ImagerySource) =>
    s.source === 'Esri Wayback' ? 0 : s.source === 'SWFWMD' ? 1 : 2
  return IMAGERY_SOURCES.filter((s) => s.year === year).sort((a, b) => rank(a) - rank(b))
}

/** "Esri Wayback · Pinellas County" — what a year's stack is made of. */
export function imageryCoverage(year: number): string {
  return [...new Set(imageryStack(year).map((s) => s.source))].join(' · ')
}
