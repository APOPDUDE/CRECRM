// Enrich properties from the 6 Tampa-area counties' PUBLIC ArcGIS REST services,
// keyed by parcel ID. Free, no API key. Appraiser-authoritative columns (owner,
// values, DOR code) are always written; shared scraped columns (lat/lng, building_sf,
// year_built, land_acres, zoning) are filled ONLY when currently null.
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
      dor_use_code: str(a.PROPERTY_USE_CODE),
      just_value: num(a.TOTAL_JST_VALUE),
      assessed_value: num(a.TOTAL_ASD_VALUE),
      land_acres: num(a.ACREAGE),
      building_sf: num(a.TOTAL_GROSS_SQFT),
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
      dor_use_code: str(a.STCD),
      just_value: num(a.JUST),
      assessed_value: num(a.ASSD),
      land_acres: num(a.MeasuredAcreage),
      building_sf: num(a.GRND_AREA ?? a.LIVING),
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
      dor_use_code: str(a.LAND_USE_CODE),
      just_value: num(a.JUST_VALUE),
      assessed_value: num(a.ASSD_VAL_COUNTY),
      land_acres: num(a.SITE_ACRES),
      building_sf: num(a.LIVING_AREA),
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
      dor_use_code: str(a.CAD_DOR_LUC_CODE),
      just_value: num(a.CAD_JUST_VALUE),
      assessed_value: num(a.CAD_ASSESSED_CTY),
      land_acres: num(a.LAND_ACREAGE_CAMA),
      building_sf: num(a.BLDGS_SQFT_LIVING),
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
      dor_use_code: str(a.DOR_CODE),
      just_value: num(a.JUST),
      assessed_value: num(a.ASD_VAL),
      land_acres: num(a.ACREAGE),
      building_sf: num(a.HEAT_AR),
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
  const res = await fetch(url.toString(), { headers: { "User-Agent": "CRE-CRM enrichment" } });
  if (!res.ok) throw new Error(`http ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(`arcgis ${JSON.stringify(data.error).slice(0, 140)}`);
  return (data.features || []) as Array<{ attributes: Attrs; geometry: unknown }>;
}

async function enrichOne(supa: any, p: any) {
  const adapter = COUNTIES[p.county];
  if (!adapter) return { id: p.id, status: "unsupported_county" };
  const firstParcel = String(p.parcel_number || "").split(",")[0].trim();
  if (!firstParcel) return { id: p.id, status: "no_parcel" };

  const norm = adapter.normalize(firstParcel);
  const field = typeof norm === "string" ? adapter.idField : norm.field;
  const value = typeof norm === "string" ? norm : norm.value;
  const stamp = new Date().toISOString();

  let feats: Array<{ attributes: Attrs; geometry: unknown }>;
  try {
    feats = await arcgisQuery(adapter.service, field, value);
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
    appraiser_data: { status: "ok", county: p.county, field, value, source: adapter.service },
    appraiser_updated_at: stamp,
  };
  if (p.lat == null && m.lat != null) upd.lat = m.lat;
  if (p.lng == null && m.lng != null) upd.lng = m.lng;
  if (p.building_sf == null && m.building_sf != null) upd.building_sf = m.building_sf;
  if (p.year_built == null && m.year_built != null) upd.year_built = m.year_built;
  if (p.land_acres == null && m.land_acres != null) upd.land_acres = m.land_acres;
  if ((p.zoning_description == null || p.zoning_description === "") && m.zoning_description) {
    upd.zoning_description = m.zoning_description;
  }

  const { error } = await supa.from("properties").update(upd).eq("id", p.id);
  if (error) return { id: p.id, status: "db_error", error: error.message };
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
      .select("id, county, parcel_number, lat, lng, building_sf, year_built, land_acres, zoning_description");
    if (ids) {
      q = q.in("id", ids);
    } else {
      q = q.is("appraiser_updated_at", null).in("county", counties).not("parcel_number", "is", null).limit(limit);
    }

    const { data: props, error } = await q;
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

    const results: any[] = [];
    for (const p of props || []) {
      results.push(await enrichOne(supa, p));
      await new Promise((r) => setTimeout(r, 150)); // be polite to county servers
    }

    let remaining: number | null = null;
    if (!ids) {
      const { count } = await supa.from("properties")
        .select("id", { count: "exact", head: true })
        .is("appraiser_updated_at", null).in("county", counties).not("parcel_number", "is", null);
      remaining = count ?? null;
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
