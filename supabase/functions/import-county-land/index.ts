// import-county-land: server-side county land harvester (Alex, 2026-08-21:
// "go through all the counties again and download the land").
//
// One invocation = one page: fetch land-class parcels (DOR 00/10/40/50-69/
// 70/99, >= 0.5 ac — the land-book scope) from the county's parcel layer and
// feed them through import_county_parcels (which dedupes against the book,
// fills blanks only, and placeholders address-less land that has coords).
// The caller loops: POST {county, offset} until next_offset comes back null.
// Idempotent end to end — re-running a page re-matches and updates nothing.
//
// This is the repeatable land sweep: schedule it (n8n or Actions) to keep the
// land book current. Field maps and WHERE shapes verified against all six
// layers 2026-08-21 (counts: Hillsborough 14,539 · Pasco 11,939 · Polk 66,469
// · Manatee 5,369 · Sarasota 4,407 · Pinellas 2,613 at >= 0.5 ac).
//
// City values ride along ONLY when county_lookup maps them: the
// properties_set_county trigger derives county from city, and an unmapped
// city would NULL the county. Keep these allowlists in lockstep with
// county_lookup.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Attrs = Record<string, unknown>;

const str = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s && s !== "null" ? s : null;
};
const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const posInt = (v: unknown): number | null => {
  const n = num(v);
  return n && n > 0 ? Math.round(n) : null;
};
const year = (v: unknown): number | null => {
  const n = num(v);
  return n && n > 1800 ? Math.round(n) : null;
};
const join = (...parts: unknown[]): string | null => {
  const s = parts.map((p) => String(p ?? "").trim()).filter(Boolean).join(" ");
  return s || null;
};

const CITY_OK: Record<string, Set<string>> = {
  Hillsborough: new Set("apollo beach,balm,brandon,dover,gibsonton,lithia,lutz,mango,odessa,plant city,riverview,ruskin,seffner,sun city center,tampa,temple terrace,thonotosassa,valrico,wimauma".split(",")),
  Manatee: new Set("anna maria,bradenton,bradenton beach,cortez,ellenton,holmes beach,lakewood ranch,myakka city,palmetto,parrish".split(",")),
  Pasco: new Set("dade city,elfers,holiday,hudson,land o lakes,land o' lakes,new port richey,port richey,san antonio,shady hills,trinity,wesley chapel,zephyrhills".split(",")),
  Pinellas: new Set("clearwater,dunedin,gulfport,indian rocks beach,indian shores,largo,madeira beach,oldsmar,palm harbor,pinellas park,safety harbor,saint pete beach,saint petersburg,seminole,st pete beach,st petersburg,tarpon springs,tierra verde,treasure island".split(",")),
  Polk: new Set("alturas,auburndale,babson park,bartow,davenport,dundee,eaton park,fort meade,frostproof,haines city,kathleen,lake alfred,lake wales,lakeland,loughman,mulberry,polk city,waverly,winter haven".split(",")),
  Sarasota: new Set("englewood,laurel,longboat key,nokomis,north port,north venice,osprey,sarasota,siesta key,venice".split(",")),
};
const city = (county: string, v: unknown): string | null => {
  const s = str(v);
  return s && CITY_OK[county].has(s.toLowerCase()) ? s : null;
};

// Land classes at each county's code width: 2-digit exact, 4-digit = 2-digit
// class + subtype, 5-digit (Pasco) = 3-digit class + subtype.
const WHERE: Record<number, (f: string) => string> = {
  2: (f) => `(${f} IN ('00','10','40','70','99') OR ${f} LIKE '5_' OR ${f} LIKE '6_')`,
  4: (f) => `(${f} LIKE '00%' OR ${f} LIKE '10%' OR ${f} LIKE '40%' OR ${f} LIKE '5%' OR ${f} LIKE '6%' OR ${f} LIKE '70%' OR ${f} LIKE '99%')`,
  5: (f) => `(${f} LIKE '000%' OR ${f} LIKE '010%' OR ${f} LIKE '040%' OR ${f} LIKE '05%' OR ${f} LIKE '06%' OR ${f} LIKE '070%' OR ${f} LIKE '099%')`,
};

type Row = Record<string, unknown>;
type Cfg = {
  url: string;
  dor: string;
  acre: string;
  width: 2 | 4 | 5;
  fields: string;
  map: (a: Attrs) => Row;
};

const COUNTIES: Record<string, Cfg> = {
  Hillsborough: {
    url: "https://maps.hillsboroughcounty.org/arcgis/rest/services/InfoLayers/HC_Parcels/FeatureServer/0",
    dor: "DOR_CODE", acre: "ACREAGE", width: 4,
    fields: "PIN,FOLIO,SITE_ADDR,SITE_CITY,SITE_ZIP,OWNER,ADDR_1,ADDR_2,CITY,STATE,ZIP,DOR_CODE,JUST,ASD_VAL,ACREAGE,HEAT_AR,ACT",
    map: (a) => ({
      parcel: str(a.PIN) ?? str(a.FOLIO), a: str(a.SITE_ADDR),
      c: city("Hillsborough", a.SITE_CITY), z: str(a.SITE_ZIP),
      own: str(a.OWNER), mail: join(a.ADDR_1, a.ADDR_2, a.CITY, a.STATE, a.ZIP),
      dor: str(a.DOR_CODE), hsf: posInt(a.HEAT_AR), ac: num(a.ACREAGE),
      yr: year(a.ACT), just: num(a.JUST), asd: num(a.ASD_VAL),
    }),
  },
  Pinellas: {
    url: "https://egis.pinellas.gov/pcpagis/rest/services/Pcpao_gov/PropertyPopup_A/MapServer/0",
    dor: "PROPERTY_USE_CODE", acre: "ACREAGE", width: 4,
    fields: "DISPLAY_STRAP,SITE_ADDR,SITE_CITY,OWNER1,ADDRESS_ZIP_CITY,PROPERTY_USE_CODE,TOTAL_JST_VALUE,TOTAL_ASD_VALUE,ACREAGE,TOTAL_GROSS_SQFT,YEAR_BUILT,LATITUDE,LONGITUDE",
    map: (a) => ({
      parcel: str(a.DISPLAY_STRAP), a: str(a.SITE_ADDR),
      c: city("Pinellas", a.SITE_CITY),
      own: str(a.OWNER1), mail: str(a.ADDRESS_ZIP_CITY),
      dor: str(a.PROPERTY_USE_CODE), sf: posInt(a.TOTAL_GROSS_SQFT), ac: num(a.ACREAGE),
      yr: year(a.YEAR_BUILT), just: num(a.TOTAL_JST_VALUE), asd: num(a.TOTAL_ASD_VALUE),
      lat: num(a.LATITUDE), lng: num(a.LONGITUDE),
    }),
  },
  Sarasota: {
    url: "https://services3.arcgis.com/icrWMv7eBkctFu1f/arcgis/rest/services/ParcelHosted/FeatureServer/0",
    dor: "STCD", acre: "MeasuredAcreage", width: 4,
    fields: "ID,FULLADDRESS,LOCCITY,LOCZIP,NAME1,NAME_ADD2,CITY,STATE,ZIP,STCD,JUST,ASSD,MeasuredAcreage,GRND_AREA,LIVING,YRBL",
    map: (a) => ({
      parcel: str(a.ID), a: str(a.FULLADDRESS),
      c: city("Sarasota", a.LOCCITY), z: str(a.LOCZIP),
      own: str(a.NAME1), mail: join(a.NAME_ADD2, a.CITY, a.STATE, a.ZIP),
      dor: str(a.STCD), sf: posInt(a.GRND_AREA), hsf: posInt(a.LIVING),
      ac: num(a.MeasuredAcreage), yr: year(a.YRBL), just: num(a.JUST), asd: num(a.ASSD),
    }),
  },
  Pasco: {
    url: "https://pascogis.pascocountyfl.net/gisweb/rest/services/PascoView/PascoMapper_R_OP/MapServer/7",
    dor: "LAND_USE_CODE", acre: "SITE_ACRES", width: 5,
    fields: "VPARCEL,SITE_ADDRESS,SITE_MAILING_CITY,SITE_ZIP,OWNER_NAME_1,MAILING_ADDRESS_1,MAILING_ADDRESS_2,MAILING_CITY,MAILING_STATE,MAILING_ZIP,LAND_USE_CODE,JUST_VALUE,ASSD_VAL_COUNTY,SITE_ACRES,LIVING_AREA,ACTUAL_YEAR_BUILT",
    map: (a) => ({
      parcel: str(a.VPARCEL), a: str(a.SITE_ADDRESS),
      c: city("Pasco", a.SITE_MAILING_CITY), z: str(a.SITE_ZIP),
      own: str(a.OWNER_NAME_1),
      mail: join(a.MAILING_ADDRESS_1, a.MAILING_ADDRESS_2, a.MAILING_CITY, a.MAILING_STATE, a.MAILING_ZIP),
      dor: str(a.LAND_USE_CODE), hsf: posInt(a.LIVING_AREA), ac: num(a.SITE_ACRES),
      yr: year(a.ACTUAL_YEAR_BUILT), just: num(a.JUST_VALUE), asd: num(a.ASSD_VAL_COUNTY),
    }),
  },
  Manatee: {
    url: "https://gis.manateepao.com/arcgis/rest/services/Website/WebLayers/MapServer/0",
    dor: "CAD_DOR_LUC_CODE", acre: "LAND_ACREAGE_CAMA", width: 2,
    fields: "PARID,SITUS_ADDRESS,SITUS_POSTAL_CITY,SITUS_POSTAL_ZIP,PAR_OWNER_NAME1,PAR_MAIL_ADDR1,PAR_MAIL_CITY,PAR_MAIL_POSTALCD,CAD_DOR_LUC_CODE,CAD_JUST_VALUE,CAD_ASSESSED_CTY,LAND_ACREAGE_CAMA,BLDGS_SQFT_LIVING,BLDG_C1_YRBUILT,BLDG_R1_YRBUILT",
    map: (a) => ({
      parcel: str(a.PARID), a: str(a.SITUS_ADDRESS),
      c: city("Manatee", a.SITUS_POSTAL_CITY), z: str(a.SITUS_POSTAL_ZIP),
      own: str(a.PAR_OWNER_NAME1),
      mail: join(a.PAR_MAIL_ADDR1, a.PAR_MAIL_CITY, a.PAR_MAIL_POSTALCD),
      dor: str(a.CAD_DOR_LUC_CODE), hsf: posInt(a.BLDGS_SQFT_LIVING),
      ac: num(a.LAND_ACREAGE_CAMA), yr: year(a.BLDG_C1_YRBUILT) ?? year(a.BLDG_R1_YRBUILT),
      just: num(a.CAD_JUST_VALUE), asd: num(a.CAD_ASSESSED_CTY),
    }),
  },
  Polk: {
    url: "https://gis.polk-county.net/server/rest/services/Map_Property_Appraiser/MapServer/1",
    dor: "DOR_CD", acre: "TOT_ACREAGE", width: 4,
    fields: "PARCELID,PROP_CITY,PROP_ZIP,NAME,MAIL_ADDR_1,MAIL_ADDR_2,MAIL_ADDR_3,MAIL_ZIP,DOR_CD,TOTALVAL,ASSESSVAL,TOT_ACREAGE,GIS_ACREAGE,YR_IMPROVED,YR_CREATED",
    map: (a) => ({
      // Polk's layer carries no situs street — rows land as 'Parcel <id>'
      // placeholders (city/zip kept) until an address backfill.
      parcel: str(a.PARCELID), a: null,
      c: city("Polk", a.PROP_CITY), z: str(a.PROP_ZIP),
      own: str(a.NAME),
      mail: join(a.MAIL_ADDR_1, a.MAIL_ADDR_2, a.MAIL_ADDR_3, a.MAIL_ZIP),
      dor: str(a.DOR_CD), ac: num(a.TOT_ACREAGE) ?? num(a.GIS_ACREAGE),
      yr: year(a.YR_IMPROVED) ?? year(a.YR_CREATED),
      just: num(a.TOTALVAL), asd: num(a.ASSESSVAL),
    }),
  },
};

// Same first-ring-average centroid enrich-appraiser uses — a screening
// coordinate, not survey truth.
function centroid(geom: unknown): { lat: number | null; lng: number | null } {
  try {
    const rings = (geom as { rings?: number[][][] })?.rings;
    const ring = rings?.[0];
    if (ring?.length) {
      let sx = 0, sy = 0;
      for (const pt of ring) { sx += pt[0]; sy += pt[1]; }
      return { lat: sy / ring.length, lng: sx / ring.length };
    }
  } catch { /* ignore */ }
  return { lat: null, lng: null };
}

// Page size: import_county_parcels is a per-row loop, and PostgREST's 8s
// statement timeout caps how many rows one call can clear — 300 fits with
// headroom (1,000 timed out, 2026-08-21). Also stays under every layer's
// maxRecordCount (min: Hillsborough 1000).
const DEFAULT_PAGE = 300;

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST {county, offset?, limit?}" }), { status: 405 });
  }
  const body = await req.json().catch(() => ({}));
  const county = String(body.county ?? "");
  const offset = Math.max(0, Number(body.offset ?? 0) || 0);
  const PAGE = Math.min(1000, Math.max(50, Number(body.limit ?? DEFAULT_PAGE) || DEFAULT_PAGE));
  const cfg = COUNTIES[county];
  if (!cfg) {
    return new Response(
      JSON.stringify({ error: `county must be one of ${Object.keys(COUNTIES).join(", ")}` }),
      { status: 400 },
    );
  }

  const where = `${WHERE[cfg.width](cfg.dor)} AND ${cfg.acre} >= 0.5`;
  const qs = new URLSearchParams({
    where,
    outFields: cfg.fields,
    resultOffset: String(offset),
    resultRecordCount: String(PAGE),
    returnGeometry: "true",
    outSR: "4326",
    f: "json",
  });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 90_000);
  let data: { features?: { attributes: Attrs; geometry?: unknown }[]; exceededTransferLimit?: boolean; error?: unknown };
  try {
    const resp = await fetch(`${cfg.url}/query?${qs}`, {
      signal: ctl.signal,
      headers: { "User-Agent": "CRE-CRM land import" },
    });
    data = await resp.json();
  } catch (e) {
    return new Response(
      JSON.stringify({ error: `county fetch failed: ${(e as Error).message}` }),
      { status: 502 },
    );
  } finally {
    clearTimeout(timer);
  }
  if (data.error) {
    return new Response(JSON.stringify({ error: "arcgis error", detail: data.error }), { status: 502 });
  }

  const feats = data.features ?? [];
  const rows: Row[] = [];
  for (const f of feats) {
    const row = cfg.map(f.attributes ?? {});
    if (!row.parcel) continue;
    if (row.lat == null || row.lng == null) {
      const c = centroid(f.geometry);
      row.lat = c.lat; row.lng = c.lng;
    }
    for (const k of Object.keys(row)) if (row[k] == null) delete row[k];
    rows.push(row);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  let tally: unknown = null;
  if (rows.length) {
    const { data: t, error } = await supabase.rpc("import_county_parcels", {
      p: { county, mode: "parcels", rows },
    });
    if (error) {
      return new Response(JSON.stringify({ error: `import failed: ${error.message}` }), { status: 500 });
    }
    tally = t;
  }

  const more = feats.length === PAGE || data.exceededTransferLimit === true;
  return new Response(
    JSON.stringify({
      county, offset, fetched: feats.length, imported: rows.length,
      next_offset: more && feats.length > 0 ? offset + feats.length : null,
      tally,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
});
