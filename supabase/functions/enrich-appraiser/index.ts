// Enrich properties from the 6 Tampa-area counties' PUBLIC ArcGIS REST services,
// keyed by parcel ID. Free, no API key. Appraiser-authoritative columns (owner,
// values, DOR code) are always written; shared scraped columns (lat/lng, gross_sf,
// heated_sf, year_built, land_acres, zoning) are filled ONLY when currently null.
//
// SF semantics (2026-08-11 rename): gross_sf = under-roof total (garages/porches in),
// heated_sf = living/finished area. County GIS popup layers mostly expose the LIVING
// figure (-> heated_sf); only Pinellas exposes a true gross (-> gross_sf).
//
// Invoke: POST { limit?: number }            -> backfill that many pending properties
//         POST { property_ids?: string[] }   -> (re)enrich specific properties
//
// SILENT-FAILURE GUARD (the #1 risk per research): a zero-row response is recorded as
// a LOUD {status:'not_found'} with the exact ID tried — never mistaken for "no data".
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type Attrs = Record<string, unknown>;
type Mapped = Record<string, number | string | null | undefined>;

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
};
const joinAddr = (...parts: unknown[]): string | null => {
  const s = parts.map(str).filter(Boolean).join(", ");
  return s || null;
};

// Rough centroid (first ring average) — fine for a map dot. Handles point geom too.
function centroid(geom: any): { lat: number | null; lng: number | null } {
  try {
    if (geom?.x != null && geom?.y != null) return { lat: geom.y, lng: geom.x };
    const ring = geom?.rings?.[0];
    if (Array.isArray(ring) && ring.length) {
      let sx = 0, sy = 0, n = 0;
      for (const pt of ring) { sx += pt[0]; sy += pt[1]; n++; }
      if (n) return { lat: sy / n, lng: sx / n };
    }
  } catch { /* ignore */ }
  return { lat: null, lng: null };
}

type Adapter = {
  service: string;
  idField: string;
  normalize: (parcel: string) => string | { field: string; value: string };
  map: (a: Attrs) => Mapped;
};

const COUNTIES: Record<string, Adapter> = {
  Polk: {
    service: "https://gis.polk-county.net/server/rest/services/Map_Property_Appraiser/MapServer/1",
    idField: "PARCELID",
    normalize: (p) => p.replace(/[^0-9]/g, ""),
    map: (a) => ({
      owner_name: str(a.NAME),
      owner_mailing_address: joinAddr(a.MAIL_ADDR_1, a.MAIL_ADDR_2, a.MAIL_ADDR_3, a.MAIL_ZIP),
      // Polk's layer exposes no situs/physical address — leave address as-is.
      dor_use_code: str(a.DOR_CD),
      just_value: num(a.TOTALVAL),
      assessed_value: num(a.ASSESSVAL),
      land_acres: num(a.TOT_ACREAGE ?? a.GIS_ACREAGE),
      year_built: num(a.YR_IMPROVED ?? a.YR_CREATED),
    }),
  },
  Pinellas: {
    service: "https://egis.pinellas.gov/pcpagis/rest/services/Pcpao_gov/PropertyPopup_A/MapServer/0",
    idField: "DISPLAY_STRAP",
    normalize: (p) => p.trim(),
    map: (a) => ({
      owner_name: str(a.OWNER1),
      owner_mailing_address: str(a.ADDRESS_ZIP_CITY),
      site_address: str(a.SITE_ADDR),
      dor_use_code: str(a.PROPERTY_USE_CODE),
      just_value: num(a.TOTAL_JST_VALUE),
      assessed_value: num(a.TOTAL_ASD_VALUE),
      land_acres: num(a.ACREAGE),
      gross_sf: num(a.TOTAL_GROSS_SQFT),
      year_built: num(a.YEAR_BUILT),
      lat: num(a.LATITUDE),
      lng: num(a.LONGITUDE),
    }),
  },
  Sarasota: {
    service: "https://services3.arcgis.com/icrWMv7eBkctFu1f/arcgis/rest/services/ParcelHosted/FeatureServer/0",
    idField: "ID",
    normalize: (p) => p.replace(/[^0-9]/g, ""),
    map: (a) => ({
      owner_name: str(a.NAME1),
      owner_mailing_address: joinAddr(a.NAME_ADD2, a.CITY, a.STATE, a.ZIP),
      site_address: str(a.FULLADDRESS),
      dor_use_code: str(a.STCD),
      just_value: num(a.JUST),
      assessed_value: num(a.ASSD),
      land_acres: num(a.MeasuredAcreage),
      heated_sf: num(a.LIVING),
      year_built: num(a.YRBL),
      zoning_description: str(a.ZONING),
    }),
  },
  Pasco: {
    service: "https://pascogis.pascocountyfl.net/gisweb/rest/services/PascoView/PascoMapper_R_OP/MapServer/7",
    idField: "VPARCEL",
    normalize: (p) => p.trim().replace(/-/g, " ").replace(/\s+/g, " "),
    map: (a) => ({
      owner_name: str(a.OWNER_NAME_1),
      owner_mailing_address: joinAddr(a.MAILING_ADDRESS_1, a.MAILING_ADDRESS_2, a.MAILING_CITY, a.MAILING_STATE, a.MAILING_ZIP),
      site_address: str(a.SITE_ADDRESS),
      dor_use_code: str(a.LAND_USE_CODE),
      just_value: num(a.JUST_VALUE),
      assessed_value: num(a.ASSD_VAL_COUNTY),
      land_acres: num(a.SITE_ACRES),
      heated_sf: num(a.LIVING_AREA),
      year_built: num(a.ACTUAL_YEAR_BUILT),
      zoning_description: str(a.ZONING),
    }),
  },
  Manatee: {
    service: "https://gis.manateepao.com/arcgis/rest/services/Website/WebLayers/MapServer/0",
    idField: "PARID",
    normalize: (p) => p.replace(/[^0-9]/g, ""),
    map: (a) => ({
      owner_name: str(a.PAR_OWNER_NAME1),
      owner_mailing_address: joinAddr(a.PAR_MAIL_ADDR1, a.PAR_MAIL_CITY, a.PAR_MAIL_POSTALCD),
      site_address: str(a.SITUS_ADDRESS),
      dor_use_code: str(a.CAD_DOR_LUC_CODE),
      just_value: num(a.CAD_JUST_VALUE),
      assessed_value: num(a.CAD_ASSESSED_CTY),
      land_acres: num(a.LAND_ACREAGE_CAMA),
      heated_sf: num(a.BLDGS_SQFT_LIVING),
      year_built: num(a.BLDG_C1_YRBUILT ?? a.BLDG_R1_YRBUILT),
      zoning_description: str(a.PAR_ZONING),
    }),
  },
  Hillsborough: {
    service: "https://maps.hillsboroughcounty.org/arcgis/rest/services/InfoLayers/HC_Parcels/FeatureServer/0",
    idField: "PIN",
    // PIN carries a letter prefix (A-/U-...); otherwise treat the value as a folio.
    normalize: (p) =>
      /[A-Za-z]/.test(p)
        ? { field: "PIN", value: p.trim().toUpperCase() }
        : { field: "FOLIO", value: p.replace(/[^0-9]/g, "") },
    map: (a) => ({
      owner_name: str(a.OWNER),
      owner_mailing_address: joinAddr(a.ADDR_1, a.ADDR_2, a.CITY, a.STATE, a.ZIP),
      site_address: str(a.SITE_ADDR),
      // Hillsborough issues two ids per parcel. We usually store the PIN, but GHL, skip
      // traces and dial sheets carry the FOLIO — keep both so either one resolves.
      folio: str(a.FOLIO),
      dor_use_code: str(a.DOR_CODE),
      just_value: num(a.JUST),
      assessed_value: num(a.ASD_VAL),
      land_acres: num(a.ACREAGE),
      heated_sf: num(a.HEAT_AR),
      year_built: num(a.ACT),
    }),
  },
};

async function arcgisQuery(service: string, field: string, value: string) {
  const url = new URL(service + "/query");
  url.searchParams.set("where", `${field}='${value.replace(/'/g, "''")}'`);
  url.searchParams.set("outFields", "*");
  url.searchParams.set("returnGeometry", "true");
  url.searchParams.set("outSR", "4326");
  url.searchParams.set("f", "json");
  // Cap each county request at 15s so one hung appraiser server can't stall the whole run.
  // AbortController + setTimeout (not AbortSignal.timeout) for portability across Deno versions.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url.toString(), {
      headers: { "User-Agent": "CRE-CRM enrichment" },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`http ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(`arcgis ${JSON.stringify(data.error).slice(0, 140)}`);
    return (data.features || []) as Array<{ attributes: Attrs; geometry: unknown }>;
  } finally {
    clearTimeout(timer);
  }
}

// Point lane (2026-09-03, parcel-first identity): the parcel whose polygon contains the
// listing's lat/lng. Scraped rows almost never carry a parcel any more (978 of 987 new rows
// in Aug 2026) but always carry a point, so this is how they get one.
async function arcgisPointQuery(service: string, lat: number, lng: number) {
  const url = new URL(service + "/query");
  url.searchParams.set("geometry", `${lng},${lat}`);
  url.searchParams.set("geometryType", "esriGeometryPoint");
  url.searchParams.set("inSR", "4326");
  url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  url.searchParams.set("outFields", "*");
  url.searchParams.set("returnGeometry", "true");
  url.searchParams.set("outSR", "4326");
  url.searchParams.set("f", "json");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url.toString(), {
      headers: { "User-Agent": "CRE-CRM enrichment" },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`http ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(`arcgis ${JSON.stringify(data.error).slice(0, 140)}`);
    return (data.features || []) as Array<{ attributes: Attrs; geometry: unknown }>;
  } finally {
    clearTimeout(timer);
  }
}

/** Esri rings -> GeoJSON Polygon/MultiPolygon for import_parcel_geoms (holes are rare on parcels; every ring kept). */
function esriRingsToGeoJson(geom: any): unknown {
  const rings = geom?.rings;
  if (!Array.isArray(rings) || !rings.length) return null;
  return rings.length === 1
    ? { type: "Polygon", coordinates: rings }
    : { type: "MultiPolygon", coordinates: rings.map((r: unknown) => [r]) };
}

async function enrichOne(supa: any, p: any) {
  const adapter = COUNTIES[p.county];
  if (!adapter) return { id: p.id, status: "unsupported_county" };
  let firstParcel = String(p.parcel_number || "").split(",")[0].trim();
  const stamp = new Date().toISOString();
  const hasPoint = typeof p.lat === "number" && typeof p.lng === "number";
  let byPoint = false;
  let feats: Array<{ attributes: Attrs; geometry: unknown }> = [];

  if (!firstParcel) {
    if (!hasPoint) return { id: p.id, status: "no_parcel" };
    try {
      feats = await arcgisPointQuery(adapter.service, p.lat, p.lng);
    } catch (e) {
      await supa.from("properties").update({
        appraiser_data: { status: "error", error: String(e), tried: { point: [p.lat, p.lng] } },
        appraiser_updated_at: stamp,
      }).eq("id", p.id);
      return { id: p.id, status: "error", error: String(e) };
    }
    const hit = String((feats[0]?.attributes || {})[adapter.idField] ?? "").trim();
    if (!feats.length || !hit) {
      await supa.from("properties").update({
        appraiser_data: { status: "not_found", tried: { county: p.county, point: [p.lat, p.lng] } },
        appraiser_updated_at: stamp,
      }).eq("id", p.id);
      return { id: p.id, status: "not_found", tried: `point=${p.lat},${p.lng}` };
    }
    firstParcel = hit;
    byPoint = true;
  }

  const norm = adapter.normalize(firstParcel);
  const field = typeof norm === "string" ? adapter.idField : norm.field;
  const value = typeof norm === "string" ? norm : norm.value;

  try {
    if (!byPoint) feats = await arcgisQuery(adapter.service, field, value);
  } catch (e) {
    await supa.from("properties").update({
      appraiser_data: { status: "error", error: String(e), tried: { field, value } },
      appraiser_updated_at: stamp,
    }).eq("id", p.id);
    return { id: p.id, status: "error", error: String(e) };
  }

  if (!feats.length) {
    await supa.from("properties").update({
      appraiser_data: { status: "not_found", tried: { county: p.county, field, value } },
      appraiser_updated_at: stamp,
    }).eq("id", p.id);
    return { id: p.id, status: "not_found", tried: `${field}=${value}` };
  }

  const m = adapter.map(feats[0].attributes || {});
  if (m.lat == null || m.lng == null) {
    const c = centroid(feats[0].geometry);
    m.lat = m.lat ?? c.lat;
    m.lng = m.lng ?? c.lng;
  }

  const upd: Record<string, unknown> = {
    owner_name: m.owner_name ?? null,
    owner_mailing_address: m.owner_mailing_address ?? null,
    just_value: m.just_value ?? null,
    assessed_value: m.assessed_value ?? null,
    dor_use_code: m.dor_use_code ?? null,
    appraiser_data: {
      status: "ok", county: p.county, field, value, source: adapter.service,
      ...(byPoint ? { matched_by: "point", point: [p.lat, p.lng] } : {}),
    },
    appraiser_updated_at: stamp,
  };
  // the point lane's whole purpose: the parcel becomes the row's identity
  if (byPoint) upd.parcel_number = firstParcel;
  if (p.lat == null && m.lat != null) upd.lat = m.lat;
  if (p.lng == null && m.lng != null) upd.lng = m.lng;
  if (p.gross_sf == null && m.gross_sf != null) upd.gross_sf = m.gross_sf;
  if (p.heated_sf == null && m.heated_sf != null) upd.heated_sf = m.heated_sf;
  if (p.year_built == null && m.year_built != null) upd.year_built = m.year_built;
  if (p.land_acres == null && m.land_acres != null) upd.land_acres = m.land_acres;
  // The county situs address is authoritative, so always keep it — properties.address may
  // hold a listing-site marketing range ("4428-4450 Eagle Falls Pl") while the county, every
  // caller and every skip trace say "4456 Eagle Falls Pl". Discarding it used to make such a
  // property unfindable by its real address; the app now displays site_address when present.
  if (m.site_address) upd.site_address = m.site_address;
  if (m.folio) upd.folio = String(m.folio).replace(/[^0-9]/g, "") || null;
  // properties.address still only gets filled when ours is blank or a parcel-only placeholder
  // ("Parcel <id>" / "Address unavailable") — never clobber what the source gave us.
  const addr = str(p.address);
  const isPlaceholder = !addr || /^parcel\b/i.test(addr) || addr.toLowerCase() === "address unavailable";
  if (isPlaceholder && m.site_address) upd.address = m.site_address;
  if ((p.zoning_description == null || p.zoning_description === "") && m.zoning_description) {
    upd.zoning_description = m.zoning_description;
  }

  const { error } = await supa.from("properties").update(upd).eq("id", p.id);
  if (error) return { id: p.id, status: "db_error", error: error.message };

  if (byPoint) {
    // keep the polygon so the NEXT source lands here by point-in-parcel at import time
    const gj = esriRingsToGeoJson(feats[0].geometry);
    if (gj) {
      await supa.rpc("import_parcel_geoms", { p: { county: p.county, rows: [{ parcel: firstParcel, geom: gj }] } });
    }
    // and fold into the property that already holds this parcel (same house number only)
    const { data: absorbed } = await supa.rpc("absorb_parcel_twin", { p_property: p.id });
    return { id: p.id, status: "ok", owner: m.owner_name ?? null, by: "point", parcel: firstParcel, absorb: absorbed?.action ?? null };
  }
  return { id: p.id, status: "ok", owner: m.owner_name ?? null };
}

Deno.serve(async (req) => {
  try {
    const supa = createClient(SUPABASE_URL, SERVICE_KEY);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const limit = Math.min(Number(body.limit) || 25, 100);
    const ids: string[] | undefined = Array.isArray(body.property_ids) ? body.property_ids : undefined;
    const counties = Object.keys(COUNTIES);

    let q = supa.from("properties")
      .select("id, address, county, parcel_number, lat, lng, gross_sf, heated_sf, year_built, land_acres, zoning_description");
    let props: any[] | null = null;
    if (ids) {
      const { data, error } = await q.in("id", ids);
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
      props = data;
    } else {
      // parcel lane first (cheap, exact), then the point lane for parcel-less rows with a pin
      const { data: a, error: ea } = await q.is("appraiser_updated_at", null).in("county", counties)
        .not("parcel_number", "is", null).limit(limit);
      if (ea) return new Response(JSON.stringify({ error: ea.message }), { status: 500 });
      props = a || [];
      // one county round-trip per row (~1s): cap the lane so a 100-row drain stays inside
      // the caller's 120s timeout (WF4 every 10 min)
      const POINT_LANE_CAP = 40;
      if (props.length < limit) {
        const { data: b, error: eb } = await supa.from("properties")
          .select("id, address, county, parcel_number, lat, lng, gross_sf, heated_sf, year_built, land_acres, zoning_description")
          .is("appraiser_updated_at", null).in("county", counties).is("parcel_number", null)
          .not("lat", "is", null).not("lng", "is", null).eq("is_condo_unit", false)
          .order("created_at", { ascending: false }).limit(Math.min(limit - props.length, POINT_LANE_CAP));
        if (eb) return new Response(JSON.stringify({ error: eb.message }), { status: 500 });
        props = props.concat(b || []);
      }
    }

    const results: any[] = [];
    for (const p of props || []) {
      results.push(await enrichOne(supa, p));
      await new Promise((r) => setTimeout(r, 150)); // be polite to county servers
    }

    let remaining: number | null = null;
    if (!ids) {
      const { count: c1 } = await supa.from("properties")
        .select("id", { count: "exact", head: true })
        .is("appraiser_updated_at", null).in("county", counties).not("parcel_number", "is", null);
      const { count: c2 } = await supa.from("properties")
        .select("id", { count: "exact", head: true })
        .is("appraiser_updated_at", null).in("county", counties).is("parcel_number", null)
        .not("lat", "is", null).not("lng", "is", null).eq("is_condo_unit", false);
      remaining = (c1 ?? 0) + (c2 ?? 0);
    }

    const tally = results.reduce((m: any, r: any) => {
      m[r.status] = (m[r.status] || 0) + 1;
      return m;
    }, {});
    return new Response(JSON.stringify({ processed: results.length, tally, remaining, results }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
