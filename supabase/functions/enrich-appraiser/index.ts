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
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

// The app calls this from the browser (Enrich / Refresh on a property). A cross-origin
// call preflights with OPTIONS, and without these headers the browser never sends the
// POST at all — the logs showed OPTIONS 200 and no POST for every click, and the UI read
// that as "Could not enrich" (2026-09-05). The n8n callers are unaffected either way.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type Attrs = Record<string, unknown>;
type Mapped = Record<string, number | string | null | undefined>;

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[^0-9.-]/g, ""));
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

/** County sale epochs are local-midnight timestamps (ms); the UTC date is the sale date. */
const epochDate = (v: unknown): string | null => {
  const n = num(v);
  if (n == null || n <= 0) return null;
  const d = new Date(n);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};
/** A recorded consideration; $0 / $100 deeds (quitclaims, family transfers) carry a date but no price. */
const salePrice = (v: unknown): number | null => {
  const n = num(v);
  return n != null && n >= 1000 ? n : null;
};

// Rough centroid (first ring average) — fine for a map dot. Handles point geom too.
type EsriGeom = { x?: number; y?: number; rings?: number[][][] } | null | undefined;

function centroid(geom: unknown): { lat: number | null; lng: number | null } {
  try {
    const g = geom as EsriGeom;
    if (g?.x != null && g?.y != null) return { lat: g.y, lng: g.x };
    const ring = g?.rings?.[0];
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
  /** the county's situs address attribute -- the house-number tie-break for point hits */
  situs: (a: Attrs) => string | null;
  /** rough county bounds [minLat, minLng, maxLat, maxLng]: which neighbours to try when the label is wrong */
  box: [number, number, number, number];
  normalize: (parcel: string) => string | { field: string; value: string };
  map: (a: Attrs) => Mapped;
};

/** Pinellas: "MM/YY |      $465,000(<span ...>Q</span>)" -> first of that month + price. */
function pinellasSale(v: unknown): { last_sale_date?: string | null; last_sale_price?: number | null } {
  const text = String(v ?? "").replace(/<[^>]+>/g, "");
  const m = text.match(/^\s*(\d{1,2})\/(\d{2,4})\s*\|\s*\$?([\d,]+)/);
  if (!m) return {};
  const mm = Number(m[1]);
  // Two-digit years pivot on today: "07/89" is 1989, "06/10" is 2010.
  const pivot = new Date().getUTCFullYear() % 100;
  const yy = m[2].length === 2 ? (Number(m[2]) <= pivot ? 2000 : 1900) + Number(m[2]) : Number(m[2]);
  if (!(mm >= 1 && mm <= 12) || !(yy >= 1900 && yy <= 2100)) return {};
  return { last_sale_date: `${yy}-${String(mm).padStart(2, "0")}-01`, last_sale_price: salePrice(m[3]) };
}

const COUNTIES: Record<string, Adapter> = {
  Polk: {
    service: "https://gis.polk-county.net/server/rest/services/Map_Property_Appraiser/MapServer/1",
    idField: "PARCELID",
    situs: (a) => [str(a.PROP_ADRNO), str(a.PROP_ADRSTR), str(a.PROP_ADRSUF)].filter(Boolean).join(" ") || null,
    box: [27.6, -82.11, 28.35, -81.1],
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
    situs: (a) => str(a.SITE_ADDR),
    box: [27.6, -82.9, 28.2, -82.55],
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
      // The popup layer exposes the latest sale only as a display string
      // ("09/17 |      $465,000(<span ...>Q</span>)"): month/year + price.
      ...pinellasSale(a.LATEST_SALE_DSP),
    }),
  },
  Sarasota: {
    service: "https://services3.arcgis.com/icrWMv7eBkctFu1f/arcgis/rest/services/ParcelHosted/FeatureServer/0",
    idField: "ID",
    situs: (a) => str(a.FULLADDRESS),
    box: [26.9, -82.75, 27.4, -82.05],
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
      last_sale_date: epochDate(a.SALE_DATE),
      last_sale_price: salePrice(a.SALE_AMT),
    }),
  },
  Pasco: {
    service: "https://pascogis.pascocountyfl.net/gisweb/rest/services/PascoView/PascoMapper_R_OP/MapServer/7",
    idField: "VPARCEL",
    situs: (a) => str(a.SITE_ADDRESS),
    box: [28.15, -82.9, 28.5, -82.05],
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
      last_sale_date: epochDate(a.SALE_DATE),
      last_sale_price: salePrice(a.SALE_AMOUNT),
    }),
  },
  Manatee: {
    service: "https://gis.manateepao.com/arcgis/rest/services/Website/WebLayers/MapServer/0",
    idField: "PARID",
    situs: (a) => str(a.SITUS_ADDRESS),
    box: [27.35, -82.75, 27.65, -82.05],
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
      last_sale_date: epochDate(a.SALE_DATE_LAST),
      last_sale_price: salePrice(a.SALE_PRICE_LAST),
    }),
  },
  Hillsborough: {
    service: "https://maps.hillsboroughcounty.org/arcgis/rest/services/InfoLayers/HC_Parcels/FeatureServer/0",
    idField: "PIN",
    situs: (a) => str(a.SITE_ADDR),
    box: [27.57, -82.65, 28.2, -82.05],
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
async function arcgisPointQuery(service: string, lat: number, lng: number, distanceM = 0) {
  const url = new URL(service + "/query");
  url.searchParams.set("geometry", `${lng},${lat}`);
  url.searchParams.set("geometryType", "esriGeometryPoint");
  url.searchParams.set("inSR", "4326");
  url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  if (distanceM > 0) {
    url.searchParams.set("distance", String(distanceM));
    url.searchParams.set("units", "esriSRUnit_Meter");
  }
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
function esriRingsToGeoJson(geom: unknown): unknown {
  const rings = (geom as EsriGeom)?.rings;
  if (!Array.isArray(rings) || !rings.length) return null;
  return rings.length === 1
    ? { type: "Polygon", coordinates: rings }
    : { type: "MultiPolygon", coordinates: rings.map((r: unknown) => [r]) };
}

/** House number of a street address ("3916-3924 Trump Pl" -> "3916"); null when there is none. */
function houseNo(addr: unknown): string | null {
  const m = String(addr ?? "").match(/^\s*(\d+)/);
  return m ? m[1] : null;
}

/** The properties columns the drain selects (both lanes select the same list). */
type PropertyRow = {
  id: string;
  address: string | null;
  county: string;
  parcel_number: string | null;
  lat: number | null;
  lng: number | null;
  gross_sf: number | null;
  heated_sf: number | null;
  last_sale_date?: string | null;
  year_built: number | null;
  land_acres: number | null;
  zoning_description: string | null;
};

type PointHit = {
  parcel?: string; county?: string; feature?: { attributes: Attrs; geometry: unknown };
  error?: string; reason?: string; tried?: string[];
};

/**
 * Which parcel does this listing's point belong to?
 *   1. a polygon we already hold (gis.parcels, via parcel_at_point) -- free, and already the property
 *   2. the labelled county's service: the point itself, then a 30 m buffer (LoopNet pins the
 *      street centreline as often as the building)
 *   3. every other county whose bounds contain the point -- Lakewood Ranch and 21st St E sit
 *      on the Manatee/Sarasota line and the city-derived county label is wrong there
 * A buffered/multi hit is accepted only when it is unique or its situs house number equals
 * the listing's; otherwise it is "ambiguous", never a guess.
 */
async function resolveParcelAtPoint(supa: SupabaseClient, p: PropertyRow): Promise<PointHit> {
  const { lat, lng } = p;
  if (lat == null || lng == null) return { reason: "no_parcel_at_point", tried: [] };
  const { data: held } = await supa.rpc("parcel_at_point", { p_lat: lat, p_lng: lng });
  if (held?.parcel_number && held?.county && COUNTIES[held.county]) {
    return { parcel: String(held.parcel_number), county: String(held.county) };
  }
  const order: string[] = [];
  if (COUNTIES[p.county]) order.push(p.county);
  for (const [name, a] of Object.entries(COUNTIES)) {
    const [s, w, n, e] = a.box;
    if (name !== p.county && lat >= s && lat <= n && lng >= w && lng <= e) order.push(name);
  }
  const want = houseNo(p.address);
  const tried: string[] = [];
  let lastErr: string | null = null;
  let ambiguous = false;
  for (const name of order) {
    const a = COUNTIES[name];
    tried.push(name);
    // 0 m: the pin is inside a parcel. 30 m: the pin is on the street outside it. 80 m: the
    // pin drifted (1440 George Jenkins Blvd sat 80 m off) -- accepted on a house-number match only.
    for (const dist of [0, 30, 80]) {
      let feats: Array<{ attributes: Attrs; geometry: unknown }>;
      try {
        feats = await arcgisPointQuery(a.service, lat, lng, dist);
      } catch (e) {
        lastErr = String(e);
        break; // this county is down or unhappy; try the next one
      }
      const withId = feats.filter((f) => String((f.attributes || {})[a.idField] ?? "").trim());
      if (!withId.length) continue;
      const exact = want ? withId.filter((f) => houseNo(a.situs(f.attributes || {})) === want) : [];
      // a lone neighbour within 30 m is accepted only when it is a real situs parcel -- the
      // road right-of-way ("Public Lands", situs 0) is the lone neighbour of every street pin
      const situsNo = (f: { attributes: Attrs }) => houseNo(a.situs(f.attributes || {}));
      const pick = exact.length === 1 ? exact[0]
        : (withId.length === 1 && (dist === 0 || (dist < 80 && situsNo(withId[0]) != null && situsNo(withId[0]) !== "0")) ? withId[0] : null);
      if (pick) {
        return { parcel: String((pick.attributes || {})[a.idField]).trim(), county: name, feature: pick };
      }
      if (withId.length > 1 && dist === 0) { ambiguous = true; break; } // overlapping (condo) parcels under the pin
      if (dist === 80) ambiguous = true; // several parcels nearby, none owning the house number
    }
  }
  if (lastErr && !ambiguous) return { error: lastErr, tried };
  return { reason: ambiguous ? "ambiguous" : "no_parcel_at_point", tried };
}

async function enrichOne(supa: SupabaseClient, p: PropertyRow) {
  let adapter = COUNTIES[p.county];
  if (!adapter) return { id: p.id, status: "unsupported_county" };
  let firstParcel = String(p.parcel_number || "").split(",")[0].trim();
  const stamp = new Date().toISOString();
  const hasPoint = typeof p.lat === "number" && typeof p.lng === "number";
  let byPoint = false;
  let feats: Array<{ attributes: Attrs; geometry: unknown }> = [];

  let county: string = p.county;
  if (!firstParcel) {
    if (!hasPoint) return { id: p.id, status: "no_parcel" };
    const found = await resolveParcelAtPoint(supa, p);
    if (found.error) {
      await supa.from("properties").update({
        appraiser_data: { status: "error", error: found.error, tried: { point: [p.lat, p.lng] } },
        appraiser_updated_at: stamp,
      }).eq("id", p.id);
      return { id: p.id, status: "error", error: found.error };
    }
    if (!found.parcel) {
      await supa.from("properties").update({
        appraiser_data: { status: "not_found", reason: found.reason, tried: { county: p.county, point: [p.lat, p.lng], counties: found.tried } },
        appraiser_updated_at: stamp,
      }).eq("id", p.id);
      return { id: p.id, status: "not_found", reason: found.reason, tried: `point=${p.lat},${p.lng}` };
    }
    firstParcel = found.parcel;
    county = found.county;
    adapter = COUNTIES[county];
    byPoint = true;
    if (found.feature) feats = [found.feature];
  }

  const norm = adapter.normalize(firstParcel);
  const field = typeof norm === "string" ? adapter.idField : norm.field;
  const value = typeof norm === "string" ? norm : norm.value;

  try {
    if (!byPoint || !feats.length) feats = await arcgisQuery(adapter.service, field, value);
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
      status: "ok", county, field, value, source: adapter.service,
      ...(byPoint ? { matched_by: "point", point: [p.lat, p.lng] } : {}),
    },
    appraiser_updated_at: stamp,
  };
  // the point lane's whole purpose: the parcel becomes the row's identity (and the county
  // the parcel actually sits in beats the city-derived label)
  if (byPoint) upd.parcel_number = firstParcel;
  if (byPoint && county !== p.county) upd.county = county;
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
  // The appraiser's last sale is authoritative: take it whenever it is newer than ours
  // (or we have none). A listing that quietly went off market usually means exactly
  // this — Refresh is how the property learns it sold (Alex 2026-09-05).
  if (typeof m.last_sale_date === "string" && (p.last_sale_date == null || m.last_sale_date > p.last_sale_date)) {
    upd.last_sale_date = m.last_sale_date;
    upd.last_sale_price = m.last_sale_price ?? null;
  }
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
      await supa.rpc("import_parcel_geoms", { p: { county, rows: [{ parcel: firstParcel, geom: gj }] } });
    }
    // and fold into the property that already holds this parcel (same house number only)
    const { data: absorbed } = await supa.rpc("absorb_parcel_twin", { p_property: p.id });
    return { id: p.id, status: "ok", owner: m.owner_name ?? null, by: "point", parcel: firstParcel, absorb: absorbed?.action ?? null };
  }
  return { id: p.id, status: "ok", owner: m.owner_name ?? null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  // Anything but a POST used to fall through to a 25-row backfill (an empty body).
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const supa = createClient(SUPABASE_URL, SERVICE_KEY);
    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Number(body.limit) || 25, 100);
    const ids: string[] | undefined = Array.isArray(body.property_ids) ? body.property_ids : undefined;
    const counties = Object.keys(COUNTIES);

    const q = supa.from("properties")
      .select("id, address, county, parcel_number, lat, lng, gross_sf, heated_sf, year_built, land_acres, zoning_description, last_sale_date");
    let props: PropertyRow[] | null = null;
    if (ids) {
      const { data, error } = await q.in("id", ids);
      if (error) return json({ error: error.message }, 500);
      props = data as PropertyRow[];
    } else {
      // parcel lane first (cheap, exact), then the point lane for parcel-less rows with a pin
      const { data: a, error: ea } = await q.is("appraiser_updated_at", null).in("county", counties)
        .not("parcel_number", "is", null).limit(limit);
      if (ea) return json({ error: ea.message }, 500);
      props = (a || []) as PropertyRow[];
      // one county round-trip per row (~1s): cap the lane so a 100-row drain stays inside
      // the caller's 120s timeout (WF4 every 10 min)
      const POINT_LANE_CAP = 40;
      if (props.length < limit) {
        const { data: b, error: eb } = await supa.from("properties")
          .select("id, address, county, parcel_number, lat, lng, gross_sf, heated_sf, year_built, land_acres, zoning_description, last_sale_date")
          .is("appraiser_updated_at", null).in("county", counties).is("parcel_number", null)
          .not("lat", "is", null).not("lng", "is", null).eq("is_condo_unit", false)
          .order("created_at", { ascending: false }).limit(Math.min(limit - props.length, POINT_LANE_CAP));
        if (eb) return json({ error: eb.message }, 500);
        props = props.concat((b || []) as PropertyRow[]);
      }
    }

    const results: Array<Awaited<ReturnType<typeof enrichOne>>> = [];
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

    const tally = results.reduce<Record<string, number>>((m, r) => {
      m[r.status] = (m[r.status] || 0) + 1;
      return m;
    }, {});
    return json({ processed: results.length, tally, remaining, results });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
