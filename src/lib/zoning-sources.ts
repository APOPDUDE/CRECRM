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
  /** The standardized allowed-uses section — what a code click should land on
   * (Alex 2026-08-16: the Hillsborough Sec. 2.02.02 use-by-district matrix is the
   * model). Merged in from USE_TABLES below. */
  useTable?: { label: string; url: string }
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

/**
 * The standardized allowed-uses section per jurisdiction — Alex's model is Hillsborough
 * Sec. 2.02.02 (a use-by-district matrix). 16 jurisdictions have a true consolidated
 * table; 9 list uses per district, so their entry lands on the district-regulations
 * article instead (the label says which). Every URL was rendered in a browser and its
 * table/section confirmed on the page before shipping (2026-08-16 verification fleet).
 */
const USE_TABLES: Record<string, { label: string; url: string }> = {
  'Hillsborough County': {
    label: 'Allowable uses table, Sec. 2.02.02',
    url: 'https://library.municode.com/fl/hillsborough_county/codes/land_development_code?nodeId=ARTIIZODI_PT2.02.00USALWIZODI_S2.02.02ALUSZODI',
  },
  'City of Tampa': {
    label: 'Use schedule, Sec. 27-156',
    url: 'https://library.municode.com/fl/tampa/codes/code_of_ordinances?nodeId=COOR_CH27ZOLADE_ARTIIIESZODIDIRE_DIV1GEZODI_S27-156OFSCDIRE',
  },
  'City of Plant City': {
    // no consolidated matrix — Article IV carries a "Uses permitted" section per district
    label: 'District regulations, Ch. 102 Art. IV',
    url: 'https://library.municode.com/fl/plant_city/codes/code_of_ordinances?nodeId=SPBBULADERE_CH102ZO_ARTIVDI',
  },
  'City of Temple Terrace': {
    label: 'District regulations, Ch. 12 Art. VII Div. 2',
    url: 'https://library.municode.com/fl/temple_terrace/codes/code_of_ordinances?nodeId=PTIICOOR_CH12LADECO_ARTVIIZO_DIV2SPZODI',
  },
  'Polk County': {
    label: 'Use table, LDC Sec. 205',
    url: 'https://library.municode.com/fl/polk_county/codes/land_development_code?nodeId=CH2LAUSDIRE_S205USTASTLAUSDIRE511RD18-025',
  },
  'City of Lakeland': {
    label: 'Permitted uses table, LDC Sec. 2.3',
    url: 'https://library.municode.com/fl/lakeland/codes/land_development_code?nodeId=LADECO_ART2USST_2.3PEUS',
  },
  'City of Winter Haven': {
    label: 'District summary tables, Sec. 21-32',
    url: 'https://library.municode.com/fl/winter_haven/codes/code_of_ordinances?nodeId=PTIICOOR_CH21UNLADECO_ARTIIRESPDI_DIV2ZODI_S21-32ZODISUTA',
  },
  'Pinellas County': {
    label: 'Table of uses, Sec. 138-355',
    url: 'https://library.municode.com/fl/pinellas_county/codes/code_of_ordinances?nodeId=PTIIILADECO_CH138ZO_ARTIIIZOLAUS_DIV3PELAUS_S138-355TAUS',
  },
  'City of St. Petersburg': {
    label: 'Use matrix, Sec. 16.10.020.1',
    url: 'https://library.municode.com/fl/st._petersburg/codes/code_of_ordinances?nodeId=PTIISTPECO_CH16LADERE_S16.10.010ESZODIMAMA_16.10.020.1MAUSPEPAREMAZOMA',
  },
  'City of Clearwater': {
    label: 'Permitted uses chart, Sec. 2-100',
    url: 'https://library.municode.com/fl/clearwater/codes/community_development_code?nodeId=PTICODECO_ART2ZODI_S2-100PEUS',
  },
  'City of Largo': {
    label: 'Allowable uses, CDC Sec. 6.1',
    url: 'https://library.municode.com/fl/largo/codes/comprehensive_development_code?nodeId=CD_CH6ALUS_S6.1CLALUS',
  },
  'City of Pinellas Park': {
    label: 'District regulations, LDC Art. 15',
    url: 'https://library.municode.com/fl/pinellas_park/codes/land_development_code?nodeId=CH18LADECO_AR15.ZO',
  },
  'City of Oldsmar': {
    label: 'District regulations, LDC Art. V',
    url: 'https://library.municode.com/fl/oldsmar/codes/code_of_ordinances?nodeId=PTIIILADECO_ARTVZORE',
  },
  'City of Tarpon Springs': {
    label: 'District regulations, Sec. 25.00',
    url: 'https://library.municode.com/fl/tarpon_springs/codes/code_of_ordinances?nodeId=COOR_APCOZOLADECO_ARTIIDIRE_S25.00SCDIRE',
  },
  'Pasco County': {
    label: 'District standards, LDC Ch. 500',
    url: 'https://library.municode.com/fl/pasco_county/codes/land_development_code?nodeId=CH500ZOST',
  },
  'City of Zephyrhills': {
    label: 'Use matrix, Sec. 2.02.01',
    url: 'https://library.municode.com/fl/zephyrhills/codes/code_of_ordinances?nodeId=LADECO_ARTIIZODIALUS_PT2.02.00LAUSALWIZODI_S2.02.01PEUS',
  },
  'City of New Port Richey': {
    label: 'District regulations, LDC Ch. 7',
    url: 'https://library.municode.com/fl/new_port_richey/codes/code_of_ordinances?nodeId=APXALADECO_CH7ZO',
  },
  'City of Dade City': {
    label: 'Table of allowed uses, Sec. 4.1.2',
    url: 'https://library.municode.com/fl/dade_city/codes/land_development_regulations?nodeId=ART4USRE_S4.1TAUS_4.1.2TAALUS',
  },
  'City of Bartow': {
    label: 'Table of uses, ULDC Sec. 2.04.00',
    url: 'https://library.municode.com/fl/bartow/codes/code_of_ordinances?nodeId=PTIICOOR_APXA_ART2RESPDI_2.04.00ESZODI',
  },
  'City of Auburndale': {
    label: 'Zoning chapter PDF (per-district)',
    url: 'https://auburndalefl.com/wp-content/uploads/2025/07/LDR-CH05-Zoning-7-16-2025.pdf',
  },
  'Sarasota County': {
    label: 'District standards, UDC Art. 6',
    url: 'https://library.municode.com/fl/sarasota_county/codes/code_of_ordinances?nodeId=PTIICOOR_CH124UNDECO_ART6GEBAINZODIDEST',
  },
  'City of Sarasota': {
    label: 'Zone districts, Art. VI',
    url: 'https://library.municode.com/fl/sarasota/codes/zoning?nodeId=ARTVIZODI',
  },
  'City of North Port': {
    label: 'Use table, ULDC Sec. 3.2.4',
    url: 'https://library.municode.com/fl/north_port/codes/unified_land_development_code?nodeId=CH3ZO_ARTIISTDI_S3.2.4STDIUSST',
  },
  'City of Venice': {
    label: 'Use table, Sec. 2.2.7',
    url: 'https://library.municode.com/fl/venice/codes/code_of_ordinances?nodeId=SPBLADERE_CH87LADECO_S2ZO_2.2TRZODI',
  },
  'Manatee County': {
    label: 'Schedule of uses, Sec. 401.2',
    url: 'https://library.municode.com/fl/manatee_county/codes/land_development_code?nodeId=CH4ZO_S401STZODIES_401.2SCUS',
  },
  'City of Bradenton': {
    label: 'Use schedules, Sec. 3.2',
    url: 'https://library.municode.com/fl/bradenton/codes/code_of_ordinances?nodeId=PTIIILAUSRE_CH3.0DIRE_3.2STLAUSATDIRE',
  },
  'City of Palmetto': {
    label: 'Use schedule, Sec. 4.2',
    url: 'https://library.municode.com/fl/palmetto/codes/code_of_ordinances?nodeId=CD_ORD_APXBZOCO_ARTIVSCDIRE_S4.2SCPECOUSDI',
  },
}

/**
 * Hand-pinned per-code targets, for jurisdictions with no searchable book (Alex:
 * "hand link the stuff"). Bartow's districts all read from one Table of Uses (PD is
 * the exception — its own planned-development section); Auburndale's districts anchor
 * into the LDR PDF at their verified page numbers.
 */
const CODE_OVERRIDES: Record<string, Record<string, string>> = {
  'City of Bartow': {
    PD: 'https://library.municode.com/fl/bartow/codes/code_of_ordinances?nodeId=PTIICOOR_APXA_ART7DEAPPR_7.04.00PLDE',
  },
  'City of Auburndale': {
    CBD: 'https://auburndalefl.com/wp-content/uploads/2025/07/LDR-CH05-Zoning-7-16-2025.pdf#page=118',
    CG: 'https://auburndalefl.com/wp-content/uploads/2025/07/LDR-CH05-Zoning-7-16-2025.pdf#page=97',
    'CG-1': 'https://auburndalefl.com/wp-content/uploads/2025/07/LDR-CH05-Zoning-7-16-2025.pdf#page=104',
    CH: 'https://auburndalefl.com/wp-content/uploads/2025/07/LDR-CH05-Zoning-7-16-2025.pdf#page=110',
    HI: 'https://auburndalefl.com/wp-content/uploads/2025/07/LDR-CH05-Zoning-7-16-2025.pdf#page=130',
    IPUD: 'https://auburndalefl.com/wp-content/uploads/2023/12/LDR-CH06-Special-ProvisionsPUDs-Clusters.pdf#page=58',
    LI: 'https://auburndalefl.com/wp-content/uploads/2025/07/LDR-CH05-Zoning-7-16-2025.pdf#page=123',
    OUA: 'https://auburndalefl.com/wp-content/uploads/2025/07/LDR-CH05-Zoning-7-16-2025.pdf#page=135',
    'RG-1': 'https://auburndalefl.com/wp-content/uploads/2025/07/LDR-CH05-Zoning-7-16-2025.pdf#page=69',
  },
}

export function zoningSourceFor(jurisdiction: string): ZoningSource | null {
  const s = SOURCES[jurisdiction]
  if (!s) return null
  const useTable = USE_TABLES[jurisdiction]
  return useTable ? { ...s, useTable } : s
}

/**
 * The best external target for ONE code, in Alex's preference order: a hand-pinned
 * section for that exact district, else the jurisdiction's ALLOWED-USES table ("a
 * standardized map of allowed uses ... would be ideal"), else the code-book search on
 * the code, else the book itself.
 */
export function zoningCodeLink(jurisdiction: string, code: string): string | null {
  const override = CODE_OVERRIDES[jurisdiction]?.[code]
  if (override) return override
  const useTable = USE_TABLES[jurisdiction]
  if (useTable) return useTable.url
  const book = SOURCES[jurisdiction]?.codeBook
  if (!book) return null
  return book.searchTemplate
    ? book.searchTemplate.replace('{CODE}', encodeURIComponent(code))
    : book.url
}
