// The six counties' public parcel ArcGIS services the map outlines parcels from, plus the
// parcel-key and ring helpers the map and the property mini-map share.
import type { Geometry } from 'geojson'
import type { LatLng } from '@/lib/geo'

type ParcelSvc = {
  name: string
  url: string
  /** rough county bounds [minLat, minLng, maxLat, maxLng] to skip irrelevant services */
  box: [number, number, number, number]
  fields: string[]
  attrs: (a: Record<string, unknown>) => { parcel: string; addr: string; owner: string; sf: string; acres: string }
}

const str0 = (v: unknown) => (v == null ? '' : String(v).trim())

export const PARCEL_SERVICES: ParcelSvc[] = [
  {
    name: 'Hillsborough',
    url: 'https://maps.hillsboroughcounty.org/arcgis/rest/services/InfoLayers/HC_Parcels/FeatureServer/0',
    box: [27.57, -82.65, 28.2, -82.05],
    fields: ['PIN', 'SITE_ADDR', 'OWNER', 'HEAT_AR', 'ACREAGE'],
    attrs: (a) => ({ parcel: str0(a.PIN), addr: str0(a.SITE_ADDR), owner: str0(a.OWNER), sf: str0(a.HEAT_AR), acres: str0(a.ACREAGE) }),
  },
  {
    name: 'Pinellas',
    url: 'https://egis.pinellas.gov/pcpagis/rest/services/Pcpao_gov/PropertyPopup_A/MapServer/0',
    box: [27.6, -82.9, 28.2, -82.55],
    fields: ['DISPLAY_STRAP', 'SITE_ADDR', 'OWNER1', 'TOTAL_GROSS_SQFT', 'ACREAGE'],
    attrs: (a) => ({ parcel: str0(a.DISPLAY_STRAP), addr: str0(a.SITE_ADDR), owner: str0(a.OWNER1), sf: str0(a.TOTAL_GROSS_SQFT), acres: str0(a.ACREAGE) }),
  },
  {
    name: 'Sarasota',
    url: 'https://services3.arcgis.com/icrWMv7eBkctFu1f/arcgis/rest/services/ParcelHosted/FeatureServer/0',
    box: [26.9, -82.75, 27.4, -82.05],
    fields: ['ID', 'FULLADDRESS', 'NAME1', 'GRND_AREA', 'MeasuredAcreage'],
    attrs: (a) => ({ parcel: str0(a.ID), addr: str0(a.FULLADDRESS), owner: str0(a.NAME1), sf: str0(a.GRND_AREA), acres: str0(a.MeasuredAcreage) }),
  },
  {
    name: 'Pasco',
    url: 'https://pascogis.pascocountyfl.net/gisweb/rest/services/PascoView/PascoMapper_R_OP/MapServer/7',
    box: [28.15, -82.9, 28.5, -82.05],
    fields: ['VPARCEL', 'SITE_ADDRESS', 'OWNER_NAME_1', 'LIVING_AREA', 'SITE_ACRES'],
    attrs: (a) => ({ parcel: str0(a.VPARCEL), addr: str0(a.SITE_ADDRESS), owner: str0(a.OWNER_NAME_1), sf: str0(a.LIVING_AREA), acres: str0(a.SITE_ACRES) }),
  },
  {
    name: 'Manatee',
    url: 'https://gis.manateepao.com/arcgis/rest/services/Website/WebLayers/MapServer/0',
    box: [27.35, -82.75, 27.65, -82.05],
    fields: ['PARID', 'SITUS_ADDRESS', 'PAR_OWNER_NAME1', 'BLDGS_SQFT_LIVING', 'LAND_ACREAGE_CAMA'],
    attrs: (a) => ({ parcel: str0(a.PARID), addr: str0(a.SITUS_ADDRESS), owner: str0(a.PAR_OWNER_NAME1), sf: str0(a.BLDGS_SQFT_LIVING), acres: str0(a.LAND_ACREAGE_CAMA) }),
  },
  {
    name: 'Polk',
    url: 'https://gis.polk-county.net/server/rest/services/Map_Property_Appraiser/MapServer/1',
    box: [27.6, -82.11, 28.35, -81.1],
    fields: ['PARCELID', 'PROP_ADRNO', 'PROP_ADRSTR', 'PROP_ADRSUF', 'NAME', 'TOT_ACREAGE'],
    attrs: (a) => ({
      parcel: str0(a.PARCELID),
      addr: [str0(a.PROP_ADRNO), str0(a.PROP_ADRSTR), str0(a.PROP_ADRSUF)].filter(Boolean).join(' '),
      owner: str0(a.NAME), sf: '', acres: str0(a.TOT_ACREAGE),
    }),
  },
]

/** Format-blind parcel key: letters+digits only (folio digits vs dashed PIN both normalize). */
export const parcelKey = (p: string | null | undefined) =>
  (p ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '') || null

/**
 * Every parcel id a property carries — an assemblage carries several.
 *
 * 343 properties store more than one parcel in the single `parcel_number` field
 * ("24-28-27-000000-033001, 24-28-27-000000-033024, …"), because that is what they are:
 * one building over four lots. The county serves those lots one at a time, so a key built
 * from the whole field matches none of them — the outlines all render as somebody else's
 * land and the property is left relying on a dot that the outlines then cover.
 *
 * Splitting is what makes an assemblage clickable, and assemblages are exactly the
 * parcels worth clicking.
 */
export const parcelKeys = (field: string | null | undefined): string[] =>
  (field ?? '')
    .split(/[,;\n]/)
    .map((part) => parcelKey(part))
    .filter((k): k is string => k != null)

/** The outer ring(s) of a GeoJSON Polygon/MultiPolygon as {lat,lng} lists (holes ignored
 * — a point in a courtyard still belongs to the parcel for our purposes). */
export function outerRings(geometry: Geometry | null | undefined): LatLng[][] {
  if (!geometry) return []
  const toRing = (ring: number[][]) => ring.map(([lng, lat]) => ({ lat, lng }))
  if (geometry.type === 'Polygon') {
    return geometry.coordinates[0] ? [toRing(geometry.coordinates[0])] : []
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates
      .map((poly) => poly[0])
      .filter((ring): ring is number[][] => ring != null)
      .map(toRing)
  }
  return []
}

export function ringsBbox(rings: LatLng[][]): [number, number, number, number] {
  let minLat = Infinity, minLng = Infinity, maxLat = -Infinity, maxLng = -Infinity
  for (const ring of rings) {
    for (const v of ring) {
      if (v.lat < minLat) minLat = v.lat
      if (v.lat > maxLat) maxLat = v.lat
      if (v.lng < minLng) minLng = v.lng
      if (v.lng > maxLng) maxLng = v.lng
    }
  }
  return [minLat, minLng, maxLat, maxLng]
}
