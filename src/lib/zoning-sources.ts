/**
 * Per-jurisdiction reference links for the zoning library — "references that link back
 * to the county" (Alex, 2026-08-16).
 *
 * Two links per jurisdiction:
 *  - `url`: the jurisdiction's published zoning GIS layer — the same verified services
 *    the pipeline ingests (data/zoning/_sources.md, field-checked 2026-08-14/15).
 *  - `codeBook`: the READABLE regulations (Municode for 24 of 25; Auburndale
 *    self-hosts). Every URL and every search template below was verified 2026-08-16 by
 *    RENDERING it in a real browser and reading the resulting page (Municode 403s
 *    server-side fetches) — never add a guessed Municode path; a wrong statute link is
 *    worse than none.
 *
 * `searchTemplate` is the per-code deep link ("click M-1, get the breakdown"). The
 * obvious `library.municode.com/fl/<slug>/search?...` path DOES NOT EXIST — Municode's
 * real search route is `library.municode.com/search?clientId=<id>&searchText=...`
 * (stateId 9 = Florida), with the client id taken from Municode's own Organizations
 * API. Each template ships exactly as tested (e.g. Tampa clientId 4583 searching "IG"
 * returned its Chapter 27 sections). Results are client-wide, so e.g. Polk mixes
 * Comprehensive Plan hits in with the LDC — still the right sections, just more of them.
 *
 * Keys are zoning_code_map.jurisdiction spellings, verbatim.
 */
export type ZoningSource = {
  label: string
  url: string
  /** The jurisdiction's readable code book, fetch-verified. */
  codeBook?: {
    label: string
    url: string
    /** Per-code search deep link with a {CODE} placeholder — only set where the
     * pattern was TESTED with a real code and returned relevant sections. */
    searchTemplate?: string
  }
}

const SOURCES: Record<string, ZoningSource> = {
  'Hillsborough County': {
    label: 'County GIS layer',
    url: 'https://gisdextweb1.hillsboroughcounty.org/arcgis/rest/services/Hosted/Zoning_and_Regulatory/FeatureServer/0',
    codeBook: {
      label: 'Land Development Code (Municode)',
      url: 'https://library.municode.com/fl/hillsborough_county/codes/land_development_code',
      searchTemplate:
        'https://library.municode.com/search?stateId=9&clientId=6247&searchText={CODE}&contentTypeId=CODES',
    },
  },
  'Pinellas County': {
    label: 'County GIS layer',
    url: 'https://services.arcgis.com/f5HgUpxURgEzTccH/arcgis/rest/services/Pinellas_Zoning2019_view/FeatureServer/0',
    codeBook: {
      label: 'Zoning code, Ch. 138 (Municode)',
      url: 'https://library.municode.com/fl/pinellas_county/codes/code_of_ordinances?nodeId=PTIIILADECO_CH138ZO',
      searchTemplate:
        'https://library.municode.com/search?stateId=9&clientId=7309&searchText={CODE}&searchMode=CLIENTMODE&contentTypeId=CODES',
    },
  },
  'Pasco County': {
    label: 'County GIS layer',
    url: 'https://mapping.pascopa.com/arcgis/rest/services/Land_Use/MapServer/1',
    codeBook: {
      label: 'Land Development Code (Municode)',
      url: 'https://library.municode.com/fl/pasco_county/codes/land_development_code',
      searchTemplate: 'https://library.municode.com/search?clientId=7229&searchText={CODE}',
    },
  },
  'Polk County': {
    // unincorporated Polk regulates via comp-plan FLU districts — this layer IS the code
    label: 'County FLU GIS layer',
    url: 'https://gis.polk-county.net/hosting/rest/services/All-In-One_Viewer/Land_Use_and_Zoning/MapServer/10',
    codeBook: {
      label: 'Land Development Code (Municode)',
      url: 'https://library.municode.com/fl/polk_county/codes/land_development_code',
      searchTemplate:
        'https://library.municode.com/search?stateId=9&clientId=11452&searchText={CODE}&contentTypeId=CODES',
    },
  },
  'Manatee County': {
    label: 'County GIS layer',
    url: 'https://www.mymanatee.org/gisits/rest/services/opendata/Planning/FeatureServer/0',
    codeBook: {
      label: 'Land Development Code (Municode)',
      url: 'https://library.municode.com/fl/manatee_county/codes/land_development_code',
      searchTemplate:
        'https://library.municode.com/search?stateId=9&clientId=6717&searchText={CODE}&contentTypeId=CODES',
    },
  },
  'Sarasota County': {
    label: 'County GIS layer',
    url: 'https://ags3.scgov.net/server/rest/services/Hosted/CountyZoning/FeatureServer/0',
    codeBook: {
      label: 'Unified Development Code (Municode)',
      url: 'https://library.municode.com/fl/sarasota_county/codes/code_of_ordinances?nodeId=PTIICOOR_CH124UNDECO',
      searchTemplate:
        'https://library.municode.com/search?stateId=9&clientId=7627&searchText={CODE}&contentTypeId=CODES',
    },
  },
  'City of Tampa': {
    label: 'City GIS layer',
    url: 'https://arcgis.tampagov.net/arcgis/rest/services/OpenData/Planning/MapServer/28',
    codeBook: {
      label: 'Zoning, Ch. 27 (Municode)',
      url: 'https://library.municode.com/fl/tampa/codes/code_of_ordinances?nodeId=COOR_CH27ZOLADE',
      searchTemplate:
        'https://library.municode.com/search?stateId=9&clientId=4583&searchText={CODE}&contentTypeId=CODES',
    },
  },
  'City of Plant City': {
    label: 'City GIS layer',
    url: 'https://services5.arcgis.com/jeNmEr1R5dgAmDnZ/arcgis/rest/services/CPC_Zoning_2_view/FeatureServer/0',
    codeBook: {
      label: 'Zoning, Ch. 102 (Municode)',
      url: 'https://library.municode.com/fl/plant_city/codes/code_of_ordinances?nodeId=SPBBULADERE_CH102ZO',
      searchTemplate:
        'https://library.municode.com/search?stateId=9&clientId=3887&searchText={CODE}&contentTypeId=CODES',
    },
  },
  'City of Temple Terrace': {
    label: 'City GIS layer',
    url: 'https://gis.tpcmaps.org/arcgis/rest/services/Rezoning/Zoning/MapServer/0',
    codeBook: {
      label: 'Land Development Code, Ch. 12 (Municode)',
      url: 'https://library.municode.com/fl/temple_terrace/codes/code_of_ordinances?nodeId=PTIICOOR_CH12LADECO',
      searchTemplate:
        'https://library.municode.com/search?stateId=9&clientId=4604&searchText={CODE}&contentTypeId=CODES',
    },
  },
  'City of St. Petersburg': {
    label: 'City GIS layer',
    url: 'https://services2.arcgis.com/9qPLjNtocjo438CJ/arcgis/rest/services/ZoningDistricts_view/FeatureServer/0',
    codeBook: {
      label: 'Land Development Regulations, Ch. 16 (Municode)',
      url: 'https://library.municode.com/fl/st._petersburg/codes/code_of_ordinances?nodeId=PTIISTPECO_CH16LADERE',
      searchTemplate:
        'https://library.municode.com/search?stateId=9&clientId=4477&searchText={CODE}&searchMode=CLIENTMODE&contentTypeId=CODES',
    },
  },
  'City of Clearwater': {
    label: 'City GIS layer',
    url: 'https://gis.myclearwater.com/arcgis/rest/services/ArcGISMapServices/Zoning_WGS84/MapServer/1',
    codeBook: {
      label: 'Community Development Code (Municode)',
      url: 'https://library.municode.com/fl/clearwater/codes/community_development_code',
      searchTemplate:
        'https://library.municode.com/search?stateId=9&clientId=1675&searchText={CODE}&searchMode=CLIENTMODE&contentTypeId=CODES',
    },
  },
  'City of Largo': {
    label: 'City GIS layer',
    url: 'https://maps.largo.com/arcgis/rest/services/Largo_GIS_Viewer_Map/MapServer/241',
    codeBook: {
      label: 'Comprehensive Development Code (Municode)',
      url: 'https://library.municode.com/fl/largo/codes/comprehensive_development_code',
      searchTemplate:
        'https://library.municode.com/search?stateId=9&clientId=2957&searchText={CODE}&searchMode=CLIENTMODE&contentTypeId=CODES',
    },
  },
  'City of Pinellas Park': {
    label: 'City GIS layer',
    url: 'https://services6.arcgis.com/fH2ZwfxOgb5eaBS4/arcgis/rest/services/Zoning__Pinellas_Park_03122025/FeatureServer/0',
    codeBook: {
      label: 'Land Development Code (Municode)',
      url: 'https://library.municode.com/fl/pinellas_park/codes/land_development_code',
      searchTemplate:
        'https://library.municode.com/search?stateId=9&clientId=3867&searchText={CODE}&searchMode=CLIENTMODE&contentTypeId=CODES',
    },
  },
  'City of Oldsmar': {
    label: 'City GIS layer',
    url: 'https://services8.arcgis.com/4LjX8EYY898im7w3/arcgis/rest/services/Public_Zoning/FeatureServer/0',
    codeBook: {
      label: 'Land Development Code (Municode)',
      url: 'https://library.municode.com/fl/oldsmar/codes/code_of_ordinances?nodeId=PTIIILADECO',
      searchTemplate:
        'https://library.municode.com/search?stateId=9&clientId=3675&searchText={CODE}&searchMode=CLIENTMODE&contentTypeId=CODES',
    },
  },
  'City of Tarpon Springs': {
    label: 'City GIS layer',
    url: 'https://gis.ctsfl.us/arcgis/rest/services/Hosted/Zoning_2025/FeatureServer/3',
    codeBook: {
      label: 'Zoning & Land Development Code (Municode)',
      url: 'https://library.municode.com/fl/tarpon_springs/codes/code_of_ordinances?nodeId=COOR_APCOZOLADECO',
      searchTemplate:
        'https://library.municode.com/search?stateId=9&clientId=4586&searchText={CODE}&searchMode=CLIENTMODE&contentTypeId=CODES',
    },
  },
  'City of Lakeland': {
    label: 'City GIS layer',
    url: 'https://services1.arcgis.com/mcbQY5xNGGGM1vBX/arcgis/rest/services/Zoning/FeatureServer/0',
    codeBook: {
      label: 'Land Development Code (Municode)',
      url: 'https://library.municode.com/fl/lakeland/codes/land_development_code',
      searchTemplate:
        'https://library.municode.com/search?stateId=9&clientId=2937&searchText={CODE}&contentTypeId=CODES',
    },
  },
  'City of Winter Haven': {
    label: 'City GIS layer',
    url: 'https://services.arcgis.com/hNKc1r3SBL6SVC6I/arcgis/rest/services/Winter_Haven_Zoning_Web_Layer/FeatureServer/0',
    codeBook: {
      label: 'Unified Land Development Code, Ch. 21 (Municode)',
      url: 'https://library.municode.com/fl/winter_haven/codes/code_of_ordinances?nodeId=PTIICOOR_CH21UNLADECO',
      searchTemplate:
        'https://library.municode.com/search?stateId=9&clientId=4998&searchText={CODE}&contentTypeId=CODES',
    },
  },
  'City of Auburndale': {
    label: 'City GIS layer',
    url: 'https://services3.arcgis.com/o0eokD8valYePyMB/arcgis/rest/services/Auburndale_Zoning/FeatureServer/3',
    // self-hosted PDFs, no searchable book — the landing page is the best verified target
    codeBook: {
      label: 'Land Development Regulations (city site)',
      url: 'https://auburndalefl.com/ldrs/',
    },
  },
  'City of Bartow': {
    label: 'City GIS layer',
    url: 'https://services8.arcgis.com/1wJDvJrOmH0GVxt1/arcgis/rest/services/Zoning_Map___City_of_Bartow_WFL1/FeatureServer/0',
    // per-code search not verifiable for Bartow's ULDC appendix — book link only
    codeBook: {
      label: 'Unified Land Development Code (Municode)',
      url: 'https://library.municode.com/fl/bartow/codes/code_of_ordinances?nodeId=PTIICOOR_APXA_UNIFIED_LAND_DEVELOPMENT_CODE',
    },
  },
  'City of Bradenton': {
    label: 'City GIS layer',
    url: 'https://services6.arcgis.com/wl0q8tN2gn8MMx1p/arcgis/rest/services/Zoning_CoB/FeatureServer/0',
    codeBook: {
      label: 'Land Use Regulations (Municode)',
      url: 'https://library.municode.com/fl/bradenton/codes/code_of_ordinances?nodeId=PTIIILAUSRE',
      searchTemplate:
        'https://library.municode.com/search?stateId=9&clientId=1372&searchText={CODE}&contentTypeId=CODES',
    },
  },
  'City of Palmetto': {
    label: 'City GIS layer',
    url: 'https://services1.arcgis.com/L2Neyx2ylSeTBS0F/arcgis/rest/services/Zoning/FeatureServer/0',
    codeBook: {
      label: 'Zoning Code, Appx. B (Municode)',
      url: 'https://library.municode.com/fl/palmetto/codes/code_of_ordinances?nodeId=CD_ORD_APXBZOCO',
      searchTemplate:
        'https://library.municode.com/search?stateId=9&clientId=3764&searchText={CODE}&contentTypeId=CODES',
    },
  },
  'City of Zephyrhills': {
    label: 'City GIS layer',
    url: 'https://services6.arcgis.com/Q4fB6OTUhdN4M9BR/arcgis/rest/services/Zhills_EnGov_Map_11_2025/FeatureServer/4',
    codeBook: {
      label: 'Land Development Code (Municode)',
      url: 'https://library.municode.com/fl/zephyrhills/codes/code_of_ordinances?nodeId=LADECO',
      searchTemplate: 'https://library.municode.com/search?clientId=5065&searchText={CODE}',
    },
  },
  'City of New Port Richey': {
    label: 'City GIS layer',
    url: 'https://services7.arcgis.com/5fOG6RMXXiEvqNzn/arcgis/rest/services/NPR_Zoning_2026/FeatureServer/0',
    codeBook: {
      label: 'Land Development Code (Municode)',
      url: 'https://library.municode.com/fl/new_port_richey/codes/code_of_ordinances?nodeId=APXALADECO',
      searchTemplate: 'https://library.municode.com/search?clientId=3526&searchText={CODE}',
    },
  },
  'City of Dade City': {
    label: 'City GIS layer',
    url: 'https://services3.arcgis.com/mmyQNjK0vr6nAsug/arcgis/rest/services/Zoning/FeatureServer/17',
    codeBook: {
      label: 'Land Development Regulations (Municode)',
      url: 'https://library.municode.com/fl/dade_city/codes/land_development_regulations_',
      searchTemplate: 'https://library.municode.com/search?clientId=1849&searchText={CODE}',
    },
  },
  'City of Sarasota': {
    label: 'City GIS layer',
    url: 'https://ags3.scgov.net/server/rest/services/Hosted/CitySarasotaZoning/FeatureServer/0',
    codeBook: {
      label: 'Zoning Code (Municode)',
      url: 'https://library.municode.com/fl/sarasota/codes/zoning',
      searchTemplate:
        'https://library.municode.com/search?stateId=9&clientId=4241&searchText={CODE}&contentTypeId=CODES',
    },
  },
  'City of North Port': {
    label: 'City GIS layer',
    url: 'https://ags3.scgov.net/server/rest/services/Hosted/CityNorthPortZoning/FeatureServer/0',
    codeBook: {
      label: 'Unified Land Development Code (Municode)',
      url: 'https://library.municode.com/fl/north_port/codes/unified_land_development_code',
      searchTemplate:
        'https://library.municode.com/search?stateId=9&clientId=3598&searchText={CODE}&contentTypeId=CODES',
    },
  },
  'City of Venice': {
    label: 'City GIS layer',
    url: 'https://ags3.scgov.net/server/rest/services/Hosted/CityVeniceZoning/FeatureServer/0',
    codeBook: {
      label: 'Land Development Code, Ch. 87 (Municode)',
      url: 'https://library.municode.com/fl/venice/codes/code_of_ordinances?nodeId=SPBLADERE_CH87LADECO',
      searchTemplate:
        'https://library.municode.com/search?stateId=9&clientId=4737&searchText={CODE}&contentTypeId=CODES',
    },
  },
}

export function zoningSourceFor(jurisdiction: string): ZoningSource | null {
  return SOURCES[jurisdiction] ?? null
}

/**
 * The best external target for ONE code: the code book's search opened on that code
 * where the pattern is verified, else the code book landing page, else nothing (the
 * jurisdiction header's GIS link stays the fallback reference).
 */
export function zoningCodeLink(jurisdiction: string, code: string): string | null {
  const book = SOURCES[jurisdiction]?.codeBook
  if (!book) return null
  return book.searchTemplate
    ? book.searchTemplate.replace('{CODE}', encodeURIComponent(code))
    : book.url
}
