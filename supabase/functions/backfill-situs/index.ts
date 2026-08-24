// backfill-situs: fill real street addresses onto the land import's
// 'Parcel <id>' placeholder rows (Alex, 2026-08-21: "we need addresses for
// skip tracing").
//
// Source: the SAME Polk parcel layer the land import already reads. The first
// harvest passed a: null for Polk on an inherited belief that the layer
// "exposes no situs address" — it does: PROP_ADRNO / PROP_ADRNO_SFX /
// PROP_ADRDIR / PROP_ADRSTR / PROP_ADRSUF / PROP_ADRSUF2 / PROP_UNITNO. Unlike
// an E911 address-point layer it covers VACANT land (Polk's Addresses layer
// was tested first: 6% coverage on our rows vs ~45% here).
//
// One invocation = one page. Caller loops POST {county, offset} until
// next_offset is null. Idempotent: the RPC is fill-null only, so re-running a
// page writes nothing the second time.
//
// Measured on our own placeholder parcels: ~1 in 20 yields a full numbered
// address, ~8 in 20 a street name only ("OLD GRADE RD"), and the rest are DOR
// "Inaccessible tracts" — landlocked, no road access, so no address exists.
// A street name still beats "Parcel 262607000000012090" for a land broker.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Attrs = Record<string, unknown>;

const t = (v: unknown): string => ('' + (v ?? '')).trim();

// Land classes at each county's DOR code width — same filter as the land import.
const WHERE: Record<number, (f: string) => string> = {
  2: (f) => `(${f} IN ('00','10','40','70','99') OR ${f} LIKE '5_' OR ${f} LIKE '6_')`,
  4: (f) => `(${f} LIKE '00%' OR ${f} LIKE '10%' OR ${f} LIKE '40%' OR ${f} LIKE '5%' OR ${f} LIKE '6%' OR ${f} LIKE '70%' OR ${f} LIKE '99%')`,
  5: (f) => `(${f} LIKE '000%' OR ${f} LIKE '010%' OR ${f} LIKE '040%' OR ${f} LIKE '05%' OR ${f} LIKE '06%' OR ${f} LIKE '070%' OR ${f} LIKE '099%')`,
};

type Cfg = {
  url: string;
  dor: string;
  acre: string;
  width: 2 | 4 | 5;
  idField: string;
  fields: string;
  /** extra server-side filter so we only page rows that HAVE an address */
  hasAddress: string;
  compose: (a: Attrs) => { parcel: string; situs: string };
};

const COUNTIES: Record<string, Cfg> = {
  Polk: {
    url: "https://gis.polk-county.net/server/rest/services/Map_Property_Appraiser/MapServer/1",
    dor: "DOR_CD", acre: "TOT_ACREAGE", width: 4,
    idField: "PARCELID",
    fields: "PARCELID,PROP_ADRNO,PROP_ADRNO_SFX,PROP_ADRDIR,PROP_ADRSTR,PROP_ADRSUF,PROP_ADRSUF2,PROP_UNITNO",
    hasAddress: "PROP_ADRSTR IS NOT NULL AND PROP_ADRSTR <> ''",
    compose: (a) => {
      // Fixed-width blank-padded values — trim every component. PROP_ADRDIR is
      // a PRE-directional, PROP_ADRSUF2 a POST-directional: they sit on
      // opposite sides of the street name.
      const rawNo = t(a.PROP_ADRNO);
      const no = (!rawNo || rawNo === '0' || rawNo === '0.0') ? '' : rawNo.split('.')[0];
      const street = [no, t(a.PROP_ADRNO_SFX), t(a.PROP_ADRDIR), t(a.PROP_ADRSTR),
                      t(a.PROP_ADRSUF), t(a.PROP_ADRSUF2)].filter(Boolean).join(' ');
      const unit = t(a.PROP_UNITNO);
      return {
        parcel: t(a.PARCELID),
        // a bare unit with no street is noise, not an address
        situs: street ? (unit ? `${street} #${unit}` : street) : '',
      };
    },
  },
};

const DEFAULT_PAGE = 2000; // layer max; the RPC is set-based so this clears fine

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST {county, offset?, limit?}" }), { status: 405 });
  }
  const body = await req.json().catch(() => ({}));
  const county = String(body.county ?? "");
  const offset = Math.max(0, Number(body.offset ?? 0) || 0);
  const PAGE = Math.min(2000, Math.max(50, Number(body.limit ?? DEFAULT_PAGE) || DEFAULT_PAGE));
  const cfg = COUNTIES[county];
  if (!cfg) {
    return new Response(
      JSON.stringify({ error: `county must be one of ${Object.keys(COUNTIES).join(", ")}` }),
      { status: 400 },
    );
  }

  const where = `${WHERE[cfg.width](cfg.dor)} AND ${cfg.acre} >= 0.5 AND ${cfg.hasAddress}`;
  const qs = new URLSearchParams({
    where, outFields: cfg.fields,
    resultOffset: String(offset), resultRecordCount: String(PAGE),
    returnGeometry: "false", f: "json",
  });

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 90_000);
  let data: { features?: { attributes: Attrs }[]; exceededTransferLimit?: boolean; error?: unknown };
  try {
    const resp = await fetch(`${cfg.url}/query?${qs}`, {
      signal: ctl.signal, headers: { "User-Agent": "CRE-CRM situs backfill" },
    });
    data = await resp.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: `county fetch failed: ${(e as Error).message}` }), { status: 502 });
  } finally {
    clearTimeout(timer);
  }
  if (data.error) {
    return new Response(JSON.stringify({ error: "arcgis error", detail: data.error }), { status: 502 });
  }

  const feats = data.features ?? [];
  const rows = feats.map((f) => cfg.compose(f.attributes ?? {}))
                    .filter((r) => r.parcel && r.situs);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  let tally: unknown = null;
  if (rows.length) {
    const { data: tl, error } = await supabase.rpc("import_situs_addresses", {
      p: { county, rows },
    });
    if (error) {
      return new Response(JSON.stringify({ error: `import failed: ${error.message}` }), { status: 500 });
    }
    tally = tl;
  }

  const more = feats.length === PAGE || data.exceededTransferLimit === true;
  return new Response(
    JSON.stringify({
      county, offset, fetched: feats.length, with_address: rows.length,
      next_offset: more && feats.length > 0 ? offset + feats.length : null,
      tally,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
});
