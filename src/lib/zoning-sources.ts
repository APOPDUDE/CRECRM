/**
 * Per-jurisdiction reference links for the zoning library — "references that link back
 * to the county" (Alex, 2026-08-16).
 *
 * Every URL here is the jurisdiction's OWN published zoning layer — the same verified
 * services the pipeline ingests (data/zoning/_sources.md, field-checked 2026-08-14/15).
 * They are ArcGIS service pages rather than prose code books: authoritative and always
 * current, if technical. Swap any entry for the jurisdiction's Municode/LDC page when
 * a human-readable one is CONFIRMED — never guess a Municode path, a wrong statute link
 * is worse than a service directory.
 *
 * Keys are zoning_code_map.jurisdiction spellings, verbatim (27 as of 2026-08-16).
 * Mulberry and Lake Wales publish NO machine-readable zoning at all (PDF-only) — they
 * get no entry, and the library shows them without a link.
 */
export type ZoningSource = { label: string; url: string }

const SOURCES: Record<string, ZoningSource> = {
  'Hillsborough County': {
    label: 'Hillsborough County zoning layer',
    url: 'https://gisdextweb1.hillsboroughcounty.org/arcgis/rest/services/Hosted/Zoning_and_Regulatory/FeatureServer/0',
  },
  'Pinellas County': {
    label: 'Pinellas County zoning layer',
    url: 'https://services.arcgis.com/f5HgUpxURgEzTccH/arcgis/rest/services/Pinellas_Zoning2019_view/FeatureServer/0',
  },
  'Pasco County': {
    label: 'Pasco County zoning layer',
    url: 'https://mapping.pascopa.com/arcgis/rest/services/Land_Use/MapServer/1',
  },
  'Polk County': {
    // unincorporated Polk regulates via comp-plan FLU districts — this layer IS the code
    label: 'Polk County future land use layer',
    url: 'https://gis.polk-county.net/hosting/rest/services/All-In-One_Viewer/Land_Use_and_Zoning/MapServer/10',
  },
  'Manatee County': {
    label: 'Manatee County zoning layer',
    url: 'https://www.mymanatee.org/gisits/rest/services/opendata/Planning/FeatureServer/0',
  },
  'Sarasota County': {
    label: 'Sarasota County zoning layer',
    url: 'https://ags3.scgov.net/server/rest/services/Hosted/CountyZoning/FeatureServer/0',
  },
  'City of Tampa': {
    label: 'Tampa zoning layer',
    url: 'https://arcgis.tampagov.net/arcgis/rest/services/OpenData/Planning/MapServer/28',
  },
  'City of Plant City': {
    label: 'Plant City zoning layer',
    url: 'https://services5.arcgis.com/jeNmEr1R5dgAmDnZ/arcgis/rest/services/CPC_Zoning_2_view/FeatureServer/0',
  },
  'City of Temple Terrace': {
    label: 'Temple Terrace zoning layer',
    url: 'https://gis.tpcmaps.org/arcgis/rest/services/Rezoning/Zoning/MapServer/0',
  },
  'City of St. Petersburg': {
    label: 'St. Petersburg zoning layer',
    url: 'https://services2.arcgis.com/9qPLjNtocjo438CJ/arcgis/rest/services/ZoningDistricts_view/FeatureServer/0',
  },
  'City of Clearwater': {
    label: 'Clearwater zoning layer',
    url: 'https://gis.myclearwater.com/arcgis/rest/services/ArcGISMapServices/Zoning_WGS84/MapServer/1',
  },
  'City of Largo': {
    label: 'Largo zoning layer',
    url: 'https://maps.largo.com/arcgis/rest/services/Largo_GIS_Viewer_Map/MapServer/241',
  },
  'City of Pinellas Park': {
    label: 'Pinellas Park zoning layer',
    url: 'https://services6.arcgis.com/fH2ZwfxOgb5eaBS4/arcgis/rest/services/Zoning__Pinellas_Park_03122025/FeatureServer/0',
  },
  'City of Oldsmar': {
    label: 'Oldsmar zoning layer',
    url: 'https://services8.arcgis.com/4LjX8EYY898im7w3/arcgis/rest/services/Public_Zoning/FeatureServer/0',
  },
  'City of Tarpon Springs': {
    label: 'Tarpon Springs zoning layer',
    url: 'https://gis.ctsfl.us/arcgis/rest/services/Hosted/Zoning_2025/FeatureServer/3',
  },
  'City of Lakeland': {
    label: 'Lakeland zoning layer',
    url: 'https://services1.arcgis.com/mcbQY5xNGGGM1vBX/arcgis/rest/services/Zoning/FeatureServer/0',
  },
  'City of Winter Haven': {
    label: 'Winter Haven zoning layer',
    url: 'https://services.arcgis.com/hNKc1r3SBL6SVC6I/arcgis/rest/services/Winter_Haven_Zoning_Web_Layer/FeatureServer/0',
  },
  'City of Auburndale': {
    label: 'Auburndale zoning layer',
    url: 'https://services3.arcgis.com/o0eokD8valYePyMB/arcgis/rest/services/Auburndale_Zoning/FeatureServer/3',
  },
  'City of Bartow': {
    label: 'Bartow zoning layer',
    url: 'https://services8.arcgis.com/1wJDvJrOmH0GVxt1/arcgis/rest/services/Zoning_Map___City_of_Bartow_WFL1/FeatureServer/0',
  },
  'City of Bradenton': {
    label: 'Bradenton zoning layer',
    url: 'https://services6.arcgis.com/wl0q8tN2gn8MMx1p/arcgis/rest/services/Zoning_CoB/FeatureServer/0',
  },
  'City of Palmetto': {
    label: 'Palmetto zoning layer',
    url: 'https://services1.arcgis.com/L2Neyx2ylSeTBS0F/arcgis/rest/services/Zoning/FeatureServer/0',
  },
  'City of Zephyrhills': {
    label: 'Zephyrhills zoning layer',
    url: 'https://services6.arcgis.com/Q4fB6OTUhdN4M9BR/arcgis/rest/services/Zhills_EnGov_Map_11_2025/FeatureServer/4',
  },
  'City of New Port Richey': {
    label: 'New Port Richey zoning layer',
    url: 'https://services7.arcgis.com/5fOG6RMXXiEvqNzn/arcgis/rest/services/NPR_Zoning_2026/FeatureServer/0',
  },
  'City of Dade City': {
    label: 'Dade City zoning layer',
    url: 'https://services3.arcgis.com/mmyQNjK0vr6nAsug/arcgis/rest/services/Zoning/FeatureServer/17',
  },
  'City of Sarasota': {
    label: 'Sarasota (city) zoning layer',
    url: 'https://ags3.scgov.net/server/rest/services/Hosted/CitySarasotaZoning/FeatureServer/0',
  },
  'City of North Port': {
    label: 'North Port zoning layer',
    url: 'https://ags3.scgov.net/server/rest/services/Hosted/CityNorthPortZoning/FeatureServer/0',
  },
  'City of Venice': {
    label: 'Venice zoning layer',
    url: 'https://ags3.scgov.net/server/rest/services/Hosted/CityVeniceZoning/FeatureServer/0',
  },
}

export function zoningSourceFor(jurisdiction: string): ZoningSource | null {
  return SOURCES[jurisdiction] ?? null
}
