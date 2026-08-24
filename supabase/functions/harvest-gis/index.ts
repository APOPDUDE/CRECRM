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
};

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
  const data = await fetchPage(cfg.url, params);
  if (data.error) {
    return new Response(JSON.stringify({ error: "arcgis error", detail: data.error }), { status: 502 });
  }
  const feats = (data.features ?? []) as { id?: number; properties?: Record<string, unknown>; geometry?: unknown }[];
  // geoJSON responses carry the OID as `id`; fall back to a stable offset index
  const features = feats.map((f, i) => {
    const attrs = f.properties ?? {};
    const fromAttr = cfg.oid ? Number(attrs[cfg.oid]) : NaN;
    return {
      oid: Number.isFinite(fromAttr)
        ? fromAttr
        : (typeof f.id === "number" ? f.id : offset + i),
      attrs,
      geom: f.geometry,
    };
  }).filter((f) => f.geom);

  let tally: unknown = null;
  if (features.length) {
    const { data: t, error } = await supabase.rpc("import_gis_features", {
      p: { source_id: source, url: cfg.url, county: cfg.county, features },
    });
    if (error) return new Response(JSON.stringify({ error: `import failed: ${error.message}` }), { status: 500 });
    tally = t;
  }
  const more = feats.length === page;
  return new Response(JSON.stringify({
    mode, source, offset, fetched: feats.length, sent: features.length,
    next_offset: more && feats.length > 0 ? offset + feats.length : null, tally,
  }), { headers: { "Content-Type": "application/json" } });
});
