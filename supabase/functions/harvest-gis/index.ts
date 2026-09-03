// harvest-gis: cache GIS layers and parcel polygons into the `gis` schema,
// server-side (Alex 2026-08-21: run it in the cloud, not on my machine).
//
// The land import proved this shape: the edge runtime fetches, a SECURITY
// DEFINER RPC writes. No GitHub Actions secrets, no local Postgres, no
// credentials for Alex to manage. PostGIS lives in the same database, so the
// spatial joins that consume this cache (enrich_parcels) never move the
// geometry anywhere.
//
// Two modes, both one-page-per-invocation, both idempotent — the caller loops
// POST {...offset} until next_offset comes back null:
//   {mode:"layer",   source:"fema_flood", offset:0}
//   {mode:"parcels", county:"Polk",       offset:0}
//
// Every configured layer here was confirmed live: reachable, paginated, and
// serving native geoJSON (so no esriJSON ring conversion is needed).
//
// v8 (2026-09-02): water/sewer mains, service areas and recorded easements per
// county — the layers behind the map's Utilities and Easements overlays and the
// water/sewer columns of parcel_enrichment. Body extras: {max_pages, budget_ms}
// let a driver shorten a drain to fit its own timeout.
// v9 (same day): keyset paging. Pasco's ArcGIS Server answers "Failed to execute
// query" once resultOffset passes ~6,000 rows (an ORDER BY sort it will not plan),
// so a `keyset` layer pages by `OID > last` instead — the cursor a driver stores is
// then the last OID seen, not a row offset. Every 2026-09-02 source uses it.
// v10 (same day): esriJSON fallback. Pasco's easement layers hold a few features
// (OBJECTID 8800-8850 general, 6800-6850 hydrology) that the server's GeoJSON
// exporter cannot serialise ("Failed to execute query") while f=json for the same
// rows works — so a page that fails under f=geojson is re-fetched as esriJSON and
// converted here (rings by orientation: Esri outer rings are clockwise).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Tampa Bay six-county envelope — every national layer is clipped to it so the
// cache stays county-sized rather than continental.
const AOI = { xmin: -83.05, ymin: 26.90, xmax: -81.05, ymax: 28.55 };

type Layer = {
  url: string;
  /** county for a county-scoped layer; null for regional/national */
  county: string | null;
  where: string;
  outFields: string;
  /** clip to the six-county envelope (false for layers already local) */
  clip: boolean;
  page: number;
  /** the layer's OBJECTID field, so paging is ordered and rows key stably.
   *  f=geojson does NOT emit `id` for these services, so we ask for the OID as
   *  an attribute and read it back out. Omit only when the layer has none. */
  oid?: string;
  /** ArcGIS maxAllowableOffset, in outSR units (degrees here). Generalizes the
   *  geometry server-side. Utility service territories are statewide polygons
   *  with millions of vertices — un-generalized, three of them are 118 KB of
   *  coordinates and the import times out; at 0.0005 deg (~55 m) the same three
   *  are 18 KB, which is far finer than a point-in-polygon "who serves this
   *  parcel" test needs. Omit for layers whose exact shape matters. */
  offsetDeg?: number;
  /** page by `oid > cursor` (needs oid) rather than resultOffset — for servers that
   *  refuse large offsets. The cursor handed back as next_offset is the last OID. */
  keyset?: boolean;
};

// GIS roots that host several of the sources below.
const HCX = "https://gisdextweb1.hillsboroughcounty.org/arcgis/rest/services/";
const SRQ = "https://services3.arcgis.com/icrWMv7eBkctFu1f/arcgis/rest/services/";
const MAN = "https://www.mymanatee.org/gisits/rest/services/";
const PAS = "https://mapping.pascopa.com/arcgis/rest/services/";

const LAYERS: Record<string, Layer> = {
  fema_flood: {
    url: "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28",
    county: null,
    // every mapped zone, incl. X — "outside the floodplain" is an answer we want
    where: "1=1",
    outFields: "OBJECTID,FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE",
    clip: true,
    page: 200,
    // Learned the hard way: this layer's first harvest ran WITHOUT ordered
    // paging and skipped features wholesale — 86% of parcels found no zone in
    // a state where nearly every parcel is in one. geojson id == OBJECTID
    // here, so the cached keys were real; re-walking ordered fills the holes.
    oid: "OBJECTID",
    offsetDeg: 0.0002,
  },
  // NWI is a JOINED layer (Wetlands + NWI_Wetland_Codes), which is why every
  // field is prefixed and why the service reports no objectIdField of its own.
  // Two consequences, both learned the hard way: an AOI-wide query just answers
  // "Failed to execute query" (261,775 features is past what it will plan), and
  // the OID has to be asked for by its joined name. So this layer is harvested
  // TILE BY TILE — pass a bbox in the request body — and keyed on the real
  // Wetlands.OBJECTID so features straddling a tile edge upsert instead of
  // duplicating.
  nwi_wetlands: {
    url: "https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/0",
    county: null,
    where: "1=1",
    outFields: "Wetlands.OBJECTID,Wetlands.ATTRIBUTE,Wetlands.WETLAND_TYPE,Wetlands.ACRES",
    clip: true,
    page: 500,
    oid: "Wetlands.OBJECTID",
    offsetDeg: 0.0002,
  },
  // polk_water_service (Map_Utilities_Service_Area/3) was tested and REMOVED:
  // the layer answers queries but serves no geometry at all (rings: 0 under
  // both f=json and f=geojson), so it can never be spatially joined.
  polk_sewer_service: {
    url: "https://gis.polk-county.net/server/rest/services/Map_Utilities_Service_Area/MapServer/2",
    county: "Polk",
    where: "1=1",
    outFields: "SERVICEAREA,SYSTEMNAME",
    clip: false,
    page: 2000,
  },

  // ---- electricity (Alex, 2026-08-21: "I want to know if power can be run to
  // the property or is it already there"). Three layers answer three different
  // halves of that question and all three are small enough to cache whole:
  //   territories  -> WHO serves this parcel (the utility you call)
  //   substations  -> where the capacity actually is
  //   transmission -> the backbone a large load would tap
  // Distribution lines (the poles on the street) are not public anywhere in
  // Florida; nothing here substitutes for a will-serve letter, and the score
  // treats these as proximity signals, not guarantees.
  electric_substations: {
    url: "https://services6.arcgis.com/OO2s4OoyCZkYJ6oE/arcgis/rest/services/Substations/FeatureServer/0",
    county: null,
    where: "1=1",
    outFields: "OBJECTID,NAME,STATUS,MAX_VOLT,MIN_VOLT,LINES",
    clip: true,
    page: 1000,
    oid: "OBJECTID",
  },
  electric_transmission: {
    url: "https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/US_Electric_Power_Transmission_Lines/FeatureServer/0",
    county: null,
    where: "1=1",
    outFields: "OBJECTID_1,OWNER,VOLTAGE,VOLT_CLASS,STATUS",
    clip: true,
    page: 1000,
    oid: "OBJECTID_1",
  },
  electric_territories: {
    url: "https://services3.arcgis.com/OYP7N6mAJJCyH6hd/arcgis/rest/services/Electric_Retail_Service_Territories_HIFLD/FeatureServer/0",
    county: null,
    where: "1=1",
    outFields: "OBJECTID,NAME,TYPE,HOLDING_CO,WEBSITE,TELEPHONE",
    clip: true,
    page: 20,
    oid: "OBJECTID",
    offsetDeg: 0.0005,
  },

  // ---- natural gas transmission (EIA/HIFLD interstate + intrastate). This is
  // the public transmission network only — local distribution mains are not
  // published, which is exactly why the PHMSA NPMS request went out.
  gas_transmission: {
    url: "https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/Natural_Gas_Interstate_and_Intrastate_Pipelines_1/FeatureServer/0",
    county: null,
    where: "1=1",
    outFields: "FID,TYPEPIPE,Operator,Status",
    clip: true,
    page: 1000,
    oid: "FID",
  },

  // ---- road + rail (FDOT RCI, one MapServer, statewide, authoritative).
  // Truck Volumes carries BOTH AADT and TRUCKAADT, so it supersedes the plain
  // AADT layer (same 7,165 segments in the AOI) and one harvest covers both.
  fdot_traffic: {
    url: "https://gis.fdot.gov/arcgis/rest/services/RCI_Layers/MapServer/19",
    county: null,
    where: "1=1",
    outFields: "OBJECTID,AADT,TRUCKAADT,ROADWAY,DESC_FRM,DESC_TO,YEAR_",
    clip: true,
    page: 1000,
    oid: "OBJECTID",
  },
  fdot_interchanges: {
    url: "https://gis.fdot.gov/arcgis/rest/services/RCI_Layers/MapServer/5",
    county: null,
    where: "1=1",
    outFields: "OBJECTID,ROADWAY,EXIT_NO,INTERCHG_T",
    clip: true,
    page: 1000,
    oid: "OBJECTID",
  },
  fdot_rail: {
    url: "https://gis.fdot.gov/arcgis/rest/services/RCI_Layers/MapServer/10",
    county: null,
    where: "1=1",
    outFields: "OBJECTID,RROUTE,COUNTY,MILEAGE",
    clip: true,
    page: 1000,
    oid: "OBJECTID",
  },

  // ---- water + sewer mains, service areas (2026-09-02). The 08-24 run concluded
  // "no usable public water/sewer geometry" after Polk's service areas came back
  // ringless; that was Polk, not the region. Hillsborough County, the City of Tampa,
  // Sarasota and Manatee all publish their mains WITH geometry, diameter and material;
  // Pinellas County withholds every line layer except force mains (its cities run
  // separate servers, unharvested); Polk and Pasco publish none. Source ids follow
  // <kind>_<jurisdiction> and are catalogued in gis.map_layers, which is what tells
  // the enrichers which counties are actually covered — a parcel in a county with no
  // mains layer must stay null, never read "none within a mile".
  wm_hillsborough: {
    url: HCX + "Hosted/HC_water/FeatureServer/7",
    county: "Hillsborough", where: "1=1",
    outFields: "objectid,diameter,material,lifecyclestatus,enabled,watertype,assettype,installdate,asbuiltlink,administrativearea,name",
    clip: false, page: 2000, oid: "objectid", keyset: true,
  },
  sg_hillsborough: {
    url: HCX + "Hosted/HC_Wastewater/FeatureServer/7",
    county: "Hillsborough", where: "1=1",
    outFields: "objectid,diameter,material,lifecyclestatus,enabled,watertype,installdate,asbuiltlink,administrativearea,name",
    clip: false, page: 2000, oid: "objectid", keyset: true,
  },
  sf_hillsborough: {
    url: HCX + "Hosted/HC_Wastewater/FeatureServer/9",
    county: "Hillsborough", where: "1=1",
    outFields: "objectid,diameter,material,lifecyclestatus,enabled,watertype,installdate,asbuiltlink,administrativearea,name",
    clip: false, page: 2000, oid: "objectid", keyset: true,
  },
  // service areas: county + Tampa + Temple Terrace + Plant City + private utilities,
  // one polygon each — the "who would serve this parcel" answer for water and sewer
  wsa_hillsborough: {
    url: HCX + "Hosted/Utility_Service_Area/FeatureServer/0",
    county: "Hillsborough", where: "1=1", outFields: "objectid,id,serviceby",
    clip: false, page: 100, oid: "objectid", keyset: true,
  },
  ssa_hillsborough: {
    url: HCX + "Hosted/Utility_Service_Area/FeatureServer/1",
    county: "Hillsborough", where: "1=1", outFields: "objectid,id,serviceby",
    clip: false, page: 100, oid: "objectid", keyset: true,
  },
  wm_tampa: {
    url: HCX + "Hosted/City_of_Tampa_Water/FeatureServer/10",
    county: "Hillsborough", where: "1=1",
    outFields: "objectid,diameter,material,lifecyclestatus,watertype,description,subtypename,ownedby,installdate,asbuiltlink,fileno",
    clip: false, page: 2000, oid: "objectid", keyset: true,
  },
  sg_tampa: {
    url: HCX + "Hosted/City_of_Tampa_Wastewater/FeatureServer/8",
    county: "Hillsborough", where: "1=1",
    outFields: "objectid,diameter,material,enabled,activeflag,ownedby,installdate,asbuilt_link,pipetype,linertype,filenumber",
    clip: false, page: 2000, oid: "objectid", keyset: true,
  },
  sf_tampa: {
    url: HCX + "Hosted/City_of_Tampa_Wastewater/FeatureServer/9",
    county: "Hillsborough", where: "1=1",
    outFields: "objectid,diameter,material,enabled,activeflag,ownedby,installdate,asbuilt_link,pipetype,filenumber",
    clip: false, page: 2000, oid: "objectid", keyset: true,
  },
  wm_sarasota: {
    url: SRQ + "WaterDistributionLineCollection/FeatureServer/510022",
    county: "Sarasota", where: "1=1",
    outFields: "OBJECTID,diameter,material,lifecyclestatus,ownedby,installdate,assetid,ASSETTYPE",
    clip: false, page: 2000, oid: "OBJECTID", keyset: true,
  },
  sg_sarasota: {
    url: SRQ + "SewerNetworkLineCollection/FeatureServer/315001",
    county: "Sarasota", where: "1=1",
    outFields: "OBJECTID,diameter,material,lifecyclestatus,ownedby,installdate,assetid,ASSETTYPE",
    clip: false, page: 2000, oid: "OBJECTID", keyset: true,
  },
  sf_sarasota: {
    url: SRQ + "SewerNetworkLineCollection/FeatureServer/315002",
    county: "Sarasota", where: "1=1",
    outFields: "OBJECTID,diameter,material,lifecyclestatus,ownedby,installdate,assetid,ASSETTYPE",
    clip: false, page: 2000, oid: "OBJECTID", keyset: true,
  },
  wm_manatee: {
    url: MAN + "opendata/utilities/FeatureServer/44",
    county: "Manatee", where: "1=1",
    outFields: "OBJECTID,DIAMETER,MATERIAL,LIFECYCLESTATUS,ENABLED,OWNER,INSTALL_DATE,RECORD_NO,SUBTYPE,RECORD_DRAWING_ONBASE_LINK",
    clip: false, page: 2000, oid: "OBJECTID", keyset: true,
  },
  sg_manatee: {
    url: MAN + "opendata/utilities/FeatureServer/71",
    county: "Manatee", where: "1=1",
    outFields: "OBJECTID,DIAMETER,MATERIAL,OWNER,INSTALL_DATE,RECORD_NO,SUBTYPE,RECORD_DRAWING_ONBASE_LINK",
    clip: false, page: 2000, oid: "OBJECTID", keyset: true,
  },
  sf_manatee: {
    url: MAN + "opendata/utilities/FeatureServer/70",
    county: "Manatee", where: "1=1",
    outFields: "OBJECTID,DIAMETER,MATERIAL,LIFECYCLESTATUS,ENABLED,OWNER,INSTALLDATE,RECORD_NO,SUBTYPE,RECORD_DRAWING_ONBASE_LINK",
    clip: false, page: 2000, oid: "OBJECTID", keyset: true,
  },
  // Pinellas County publishes its force mains with geometry and nothing else — its
  // water distribution and gravity sewer layers answer counts but serve no rings.
  sf_pinellas: {
    url: "https://egis.pinellas.gov/gis/rest/services/UtilitiesValves/SanitarySewerNetwork/MapServer/320",
    county: "Pinellas", where: "1=1",
    outFields: "OBJECTID,DIAMETER,MATERIAL,LIFECYCLESTATUS,ENABLED,ACTIVEFLAG,OWNEDBY,INSTALLDATE,STATUS",
    clip: false, page: 1000, oid: "OBJECTID", keyset: true,
  },

  // ---- recorded easements (2026-09-02). What the recorder's office has plotted:
  // (Pasco's general + hydrology families carry the heaviest polygons and page at
  // 500 — at 1,000 the server gave up mid-walk even before the offset problem.)
  // Pasco's Property Appraiser (four families, each with the instrument's book and
  // page — OR/PB/CB), Pinellas County's easement + right-of-way inventory (OR
  // book-page in ROWID_), St. Petersburg's encumbrance lines, Manatee's conservation
  // easements. Hillsborough, Polk and Sarasota publish no parcel-level easement
  // geometry — the recorder's instruments there are searchable, not plotted.
  ez_pasco_general: {
    url: PAS + "Easements/MapServer/1", county: "Pasco", where: "1=1",
    outFields: "OBJECTID,ETYPE,TYPE,BOOK,PAGE,ASOB,BENEFICIARY", clip: false, page: 500, oid: "OBJECTID", keyset: true,
  },
  ez_pasco_hydrology: {
    url: PAS + "Easements/MapServer/2", county: "Pasco", where: "1=1",
    outFields: "OBJECTID,ETYPE,TYPE,BOOK,PAGE,ASOB,BENEFICIARY", clip: false, page: 500, oid: "OBJECTID", keyset: true,
  },
  ez_pasco_utility: {
    url: PAS + "Easements/MapServer/3", county: "Pasco", where: "1=1",
    outFields: "OBJECTID,ETYPE,TYPE,BOOK,PAGE,ASOB,BENEFICIARY", clip: false, page: 1000, oid: "OBJECTID", keyset: true,
  },
  ez_pasco_buffer: {
    url: PAS + "Easements/MapServer/0", county: "Pasco", where: "1=1",
    outFields: "OBJECTID,ETYPE,TYPE,BOOK,PAGE,ASOB", clip: false, page: 1000, oid: "OBJECTID", keyset: true,
  },
  ez_pinellas: {
    url: "https://egis.pinellas.gov/gis/rest/services/PublicWebGIS/RightOfWay/MapServer/100",
    county: "Pinellas", where: "1=1",
    outFields: "OBJECTID,ROWID_,SRCREF,ROWTYPE,DOCUMENTTYPE,OWNERNAME,ACQUIREDATE,PUBLICROW,VACROW,UTILITYROW,DRAINROW,SIDEWALKROW,ESMTRIGHTS",
    clip: false, page: 1000, oid: "OBJECTID", keyset: true,
  },
  ez_stpete: {
    url: "https://egis.stpete.org/arcgis/rest/services/ServicesDOTS/Easements/MapServer/0",
    county: "Pinellas", where: "1=1",
    outFields: "OBJECTID,ENCUMID,SRCREF,ENCUMTYPE,ESMTWIDTH,ESMTLENGTH,CREATESOURCE,VACATESOURCE,VACATEDATE,PRIVATE,LABELTXT",
    clip: false, page: 1000, oid: "OBJECTID", keyset: true,
  },
  ez_manatee_conservation: {
    url: MAN + "NaturalResources/conservationeasements/MapServer/0",
    county: "Manatee", where: "1=1",
    outFields: "OBJECTID,GIS_LABEL,SOURCE", clip: false, page: 1000, oid: "OBJECTID", keyset: true,
  },
  // v11 (2026-09-02, "look a little harder"): the county servers hide nothing more,
  // but ArcGIS Online does. The Hillsborough County Property Appraiser publishes its
  // parcel-fabric easements county-wide (54k polygons classified Utility / Drainage /
  // Conservation / Ingress-Egress / prescriptive ROW; instrument refs only where the
  // mapper typed them into Name), the City of Lakeland publishes one master easement
  // layer with book/page, width and a flag per type, and FDEP's CLEAR inventory carries
  // every recorded conservation easement in the state (county: null = applies to every
  // county — the enrichers treat those as statewide coverage). Pages are small: these
  // are heavy polygons, and a 2,000-feature page blew import_gis_features' 8 s budget.
  ez_hillsborough_pa: {
    url: "https://services.arcgis.com/apTfC6SUmnNfnxuF/arcgis/rest/services/HCPA_Property_Easements/FeatureServer/0",
    county: "Hillsborough", where: "1=1",
    outFields: "FID,Name,Encumbranc,StatedArea,Historical", clip: false, page: 500, oid: "FID", keyset: true,
  },
  ez_lakeland: {
    url: "https://services1.arcgis.com/mcbQY5xNGGGM1vBX/arcgis/rest/services/Easements/FeatureServer/3",
    county: "Polk", where: "1=1",
    outFields: "OBJECTID,RECORDED,REC_TYPE,BOOK,PAGE,LABEL,WIDTH,WIDTH_TYPE,WIDTHVARIES,BLANKET,SUBORDINATION,VACATED,PRELIMARY,UTILITY,ELECTRIC,DRAINAGE,WATER,WASTEWATER,GAS,INGRESS_EGRESS,SIDEWALK,PEDESTRIAN,LANDSCAPE,COMMUNICATION,LIFTSTATION,TRAFFICSIGNALIZATION,RDWY_DRWY_ALLEY,WALLFENCE,LINEOFSITE,ENVIRONMENTALTYPE,PRIVATE_ESMT,PUBLIC_ESMT,OWNER,ONBASE_URL",
    clip: false, page: 500, oid: "OBJECTID", keyset: true,
  },
  ez_fdep_clear_conservation: {
    url: "https://ca.dep.state.fl.us/arcgis/rest/services/OpenData/STATE_OWNED_LANDS/MapServer/1",
    county: null, where: "1=1",
    outFields: "OBJECTID,FL_SOLARIS_LAND_ID,LOCATION_NAME,GRANTEE_TYPE_NAME,AGENCY_NAME,INVENTORY_ACRES_NBR",
    clip: true, page: 100, oid: "OBJECTID", keyset: true,
  },
};

// Parcel polygon sources — the same layers the land import reads, asked for
// geometry this time. Land-class + acreage filter keeps the cache to the book.
const PARCEL_WHERE: Record<number, (f: string) => string> = {
  2: (f) => `(${f} IN ('00','10','40','70','99') OR ${f} LIKE '5_' OR ${f} LIKE '6_')`,
  4: (f) => `(${f} LIKE '00%' OR ${f} LIKE '10%' OR ${f} LIKE '40%' OR ${f} LIKE '5%' OR ${f} LIKE '6%' OR ${f} LIKE '70%' OR ${f} LIKE '99%')`,
  5: (f) => `(${f} LIKE '000%' OR ${f} LIKE '010%' OR ${f} LIKE '040%' OR ${f} LIKE '05%' OR ${f} LIKE '06%' OR ${f} LIKE '070%' OR ${f} LIKE '099%')`,
};

type ParcelSrc = { url: string; id: string; dor: string; acre: string; width: 2 | 4 | 5; page: number };

const PARCELS: Record<string, ParcelSrc> = {
  Polk: { url: "https://gis.polk-county.net/server/rest/services/Map_Property_Appraiser/MapServer/1", id: "PARCELID", dor: "DOR_CD", acre: "TOT_ACREAGE", width: 4, page: 500 },
  Hillsborough: { url: "https://maps.hillsboroughcounty.org/arcgis/rest/services/InfoLayers/HC_Parcels/FeatureServer/0", id: "PIN", dor: "DOR_CODE", acre: "ACREAGE", width: 4, page: 500 },
  Pasco: { url: "https://pascogis.pascocountyfl.net/gisweb/rest/services/PascoView/PascoMapper_R_OP/MapServer/7", id: "VPARCEL", dor: "LAND_USE_CODE", acre: "SITE_ACRES", width: 5, page: 500 },
  Manatee: { url: "https://gis.manateepao.com/arcgis/rest/services/Website/WebLayers/MapServer/0", id: "PARID", dor: "CAD_DOR_LUC_CODE", acre: "LAND_ACREAGE_CAMA", width: 2, page: 500 },
  Sarasota: { url: "https://services3.arcgis.com/icrWMv7eBkctFu1f/arcgis/rest/services/ParcelHosted/FeatureServer/0", id: "ID", dor: "STCD", acre: "MeasuredAcreage", width: 4, page: 500 },
  Pinellas: { url: "https://egis.pinellas.gov/pcpagis/rest/services/Pcpao_gov/PropertyPopup_A/MapServer/0", id: "DISPLAY_STRAP", dor: "PROPERTY_USE_CODE", acre: "ACREAGE", width: 4, page: 500 },
};

async function fetchPage(url: string, params: Record<string, string>) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 100_000);
  try {
    const resp = await fetch(`${url}/query?${new URLSearchParams(params)}`, {
      signal: ctl.signal, headers: { "User-Agent": "CRE-CRM enrichment" },
    });
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

// ---- esriJSON -> GeoJSON, for the pages a server will not serve as GeoJSON.
type Pos = [number, number];
function ringArea(r: Pos[]): number {
  let a = 0;
  for (let i = 0, n = r.length; i < n; i++) {
    const [x1, y1] = r[i], [x2, y2] = r[(i + 1) % n];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}
function pointInRing(p: Pos, r: Pos[]): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function esriToGeoJson(g: Record<string, unknown> | null | undefined): unknown {
  if (!g) return null;
  if (typeof g.x === "number" && typeof g.y === "number") return { type: "Point", coordinates: [g.x, g.y] };
  if (Array.isArray(g.paths)) {
    const paths = g.paths as Pos[][];
    return paths.length === 1 ? { type: "LineString", coordinates: paths[0] } : { type: "MultiLineString", coordinates: paths };
  }
  if (Array.isArray(g.rings)) {
    // Esri: outer rings clockwise (negative shoelace area), holes counter-clockwise.
    // A hole belongs to the outer ring that contains its first vertex.
    const rings = g.rings as Pos[][];
    const outers: Pos[][][] = [];
    const holes: Pos[][] = [];
    for (const r of rings) (ringArea(r) < 0 ? outers : holes).push(ringArea(r) < 0 ? [r] : r);
    for (const h of holes) {
      const host = outers.find((poly) => pointInRing(h[0], poly[0])) ?? outers[0];
      if (host) host.push(h); else outers.push([h]);
    }
    if (outers.length === 0) return null;
    return outers.length === 1 ? { type: "Polygon", coordinates: outers[0] } : { type: "MultiPolygon", coordinates: outers };
  }
  return null; // true curves etc. — dropped, never faked
}

/** A page as GeoJSON; when the server's GeoJSON exporter fails on it, the same page as esriJSON, converted. */
async function fetchPageResilient(url: string, params: Record<string, string>) {
  const data = await fetchPage(url, params);
  if (!data.error) return data;
  const esri = await fetchPage(url, { ...params, f: "json" });
  if (esri.error) return data; // report the original failure
  const feats = (esri.features ?? []) as { attributes?: Record<string, unknown>; geometry?: Record<string, unknown> }[];
  return {
    features: feats.map((f) => ({ type: "Feature", properties: f.attributes ?? {}, geometry: esriToGeoJson(f.geometry) })),
    fallback: "esrijson",
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: 'POST {mode:"layer"|"parcels", ...}' }), { status: 405 });
  }
  const body = await req.json().catch(() => ({}));
  const mode = String(body.mode ?? "layer");
  const offset = Math.max(0, Number(body.offset ?? 0) || 0);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  if (mode === "parcels") {
    const county = String(body.county ?? "");
    const src = PARCELS[county];
    if (!src) {
      return new Response(JSON.stringify({ error: `county must be one of ${Object.keys(PARCELS).join(", ")}` }), { status: 400 });
    }
    const page = Math.min(1000, Math.max(50, Number(body.limit ?? src.page) || src.page));
    const where = `${PARCEL_WHERE[src.width](src.dor)} AND ${src.acre} >= 0.5`;
    const data = await fetchPage(src.url, {
      where, outFields: src.id, returnGeometry: "true", outSR: "4326",
      resultOffset: String(offset), resultRecordCount: String(page), f: "geojson",
    });
    if (data.error) {
      return new Response(JSON.stringify({ error: "arcgis error", detail: data.error }), { status: 502 });
    }
    const feats = (data.features ?? []) as { properties?: Record<string, unknown>; geometry?: unknown }[];
    const rows = feats
      .map((f) => ({ parcel: String((f.properties ?? {})[src.id] ?? "").trim(), geom: f.geometry }))
      .filter((r) => r.parcel && r.geom);

    let tally: unknown = null;
    if (rows.length) {
      const { data: t, error } = await supabase.rpc("import_parcel_geoms", { p: { county, rows } });
      if (error) return new Response(JSON.stringify({ error: `import failed: ${error.message}` }), { status: 500 });
      tally = t;
    }
    const more = feats.length === page;
    return new Response(JSON.stringify({
      mode, county, offset, fetched: feats.length, sent: rows.length,
      next_offset: more && feats.length > 0 ? offset + feats.length : null, tally,
    }), { headers: { "Content-Type": "application/json" } });
  }

  // ---- layer mode ----
  const source = String(body.source ?? "");
  const cfg = LAYERS[source];
  if (!cfg) {
    return new Response(JSON.stringify({ error: `source must be one of ${Object.keys(LAYERS).join(", ")}` }), { status: 400 });
  }
  const page = Math.min(2000, Math.max(5, Number(body.limit ?? cfg.page) || cfg.page));
  const params: Record<string, string> = {
    where: cfg.where, outFields: cfg.outFields, returnGeometry: "true", outSR: "4326",
    resultOffset: String(offset), resultRecordCount: String(page), f: "geojson",
    // 6 decimal places is ~11 cm — well past parcel precision, and it halves
    // the payload on every layer.
    geometryPrecision: "6",
  };
  if (cfg.offsetDeg) params.maxAllowableOffset = String(cfg.offsetDeg);
  // offset paging over an unordered result set can repeat or skip rows between
  // pages; ordering by the OID makes the walk deterministic.
  if (cfg.oid) params.orderByFields = cfg.oid;
  if (cfg.clip) {
    // A caller may narrow the envelope to one tile: some services cannot plan a
    // query over the whole AOI at all (see nwi_wetlands).
    const bbox = typeof body.bbox === "string" && /^[-\d.,]+$/.test(body.bbox)
      ? body.bbox
      : `${AOI.xmin},${AOI.ymin},${AOI.xmax},${AOI.ymax}`;
    params.geometry = bbox;
    params.geometryType = "esriGeometryEnvelope";
    params.inSR = "4326";
    params.spatialRel = "esriSpatialRelIntersects";
  }
  // drain mode: loop pages inside ONE invocation until the query is exhausted.
  // Exists so pg_cron + pg_net can drive a harvest with no external runner at
  // all — one POST per tile, no offset bookkeeping outside this function.
  const drain = body.drain === true;
  // a driver with its own clock (pg_net's timeout) can ask for less than the default
  const maxPages = Math.min(40, Math.max(1, Number(body.max_pages ?? 40) || 40));
  const budgetMs = Math.min(110_000, Math.max(10_000, Number(body.budget_ms ?? 110_000) || 110_000));
  const started = Date.now();
  let cursor = offset;
  let pages = 0;
  let sentTotal = 0;
  let tally: unknown = null;
  const keyset = cfg.keyset === true && !!cfg.oid;
  for (;;) {
    if (keyset) {
      // cursor is the last OID already cached; ask for what follows it
      params.where = cursor > 0 ? `(${cfg.where}) AND ${cfg.oid} > ${cursor}` : cfg.where;
      delete params.resultOffset;
    } else {
      params.resultOffset = String(cursor);
    }
    const data = await fetchPageResilient(cfg.url, params);
    if (data.error) {
      return new Response(JSON.stringify({ error: "arcgis error", detail: data.error, at: cursor }), { status: 502 });
    }
    const feats = (data.features ?? []) as { id?: number; properties?: Record<string, unknown>; geometry?: unknown }[];
    // geoJSON responses carry the OID as `id`; fall back to a stable offset index
    const features = feats.map((f, i) => {
      const attrs = f.properties ?? {};
      const fromAttr = cfg.oid ? Number(attrs[cfg.oid]) : NaN;
      return {
        oid: Number.isFinite(fromAttr)
          ? fromAttr
          : (typeof f.id === "number" ? f.id : cursor + i),
        attrs,
        geom: f.geometry,
      };
    }).filter((f) => f.geom);

    if (features.length) {
      const { data: t, error } = await supabase.rpc("import_gis_features", {
        p: { source_id: source, url: cfg.url, county: cfg.county, features },
      });
      if (error) return new Response(JSON.stringify({ error: `import failed: ${error.message}`, at: cursor }), { status: 500 });
      tally = t;
    }
    pages += 1;
    sentTotal += features.length;
    const more = feats.length === page;
    if (keyset) {
      // the walk is ordered by OID, so the page's last OID is the next cursor
      const oids = feats.map((f) => Number((f.properties ?? {})[cfg.oid!])).filter((n) => Number.isFinite(n));
      cursor = more && oids.length > 0 ? Math.max(...oids) : -1;
    } else {
      cursor = more && feats.length > 0 ? cursor + feats.length : -1;
    }
    // single-page mode, exhausted, or out of budget (edge wall clock is 150s)
    if (!drain || cursor < 0 || pages >= maxPages || Date.now() - started > budgetMs) {
      return new Response(JSON.stringify({
        mode, source, offset, pages, sent: sentTotal,
        next_offset: cursor >= 0 ? cursor : null, complete: cursor < 0, tally,
      }), { headers: { "Content-Type": "application/json" } });
    }
  }
});
