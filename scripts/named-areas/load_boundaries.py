#!/usr/bin/env python3
"""Load FL county + city/CDP boundary rings into public.named_areas.

Source: Census cartographic boundary files (500k, clipped to shoreline):
  cb_2023_us_county_500k  -> the 67 FL counties
  cb_2023_12_place_500k   -> FL incorporated places AND CDPs (Brandon, Riverview...)

Pipeline: download zips -> duckdb spatial reads the shapefiles -> simplify ->
outer rings as [lat,lng] (holes dropped; target areas are broker intent, not
cadastral truth) -> POST in chunks through the token-gated `bulk-load` edge fn
-> import_named_areas() upserts on (kind, name). Replay-safe.

Usage:  python3 scripts/named-areas/load_boundaries.py [--dry-run]

Creds: SUPABASE_ANON_KEY env, else parsed from secrets.md. Loader token is the
bulk-load pipe's x-loader-token (env BULK_LOADER_TOKEN, else the known value).
"""

import io
import json
import os
import re
import sys
import time
import urllib.request
import zipfile

import duckdb

BASE = "https://www2.census.gov/geo/tiger/GENZ2023/shp"
COUNTY_ZIP = "cb_2023_us_county_500k.zip"
PLACE_ZIP = "cb_2023_12_place_500k.zip"
SUPABASE_URL = "https://sxlttnxcutnrdzcldafh.supabase.co"
LOADER_TOKEN = os.environ.get("BULK_LOADER_TOKEN", "-fLSGTHHifozz5-HHcK8LN-RPa0tP8hg")
SECRETS = "/Users/apop/CRE CRM/secrets.md"

# Simplification tolerance in degrees (~110m per 0.001). Counties can be coarser.
TOL_COUNTY = 0.004
TOL_CITY = 0.0015
MAX_PARTS = 6          # keep at most this many polygon parts per area
MIN_PART_FRAC = 0.03   # parts smaller than 3% of the largest part are dropped
ROUND = 5              # decimal places on vertices


def anon_key() -> str:
    k = os.environ.get("SUPABASE_ANON_KEY")
    if k:
        return k
    text = open(SECRETS, encoding="utf-8").read()
    m = re.search(r"Anon key.*?\n\s*`?(eyJ[A-Za-z0-9._-]+)`?", text, re.S)
    if not m:
        sys.exit("anon key not found (set SUPABASE_ANON_KEY or check secrets.md)")
    return m.group(1)


def fetch(url: str, dest: str) -> str:
    if os.path.exists(dest):
        return dest
    print(f"downloading {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "cre-crm-loader/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r, open(dest, "wb") as f:
        f.write(r.read())
    return dest


def unzip(zpath: str, outdir: str) -> str:
    with zipfile.ZipFile(zpath) as z:
        z.extractall(outdir)
    shp = [n for n in os.listdir(outdir) if n.endswith(".shp")]
    return os.path.join(outdir, shp[0])


def ring_area(ring):
    """Planar shoelace in deg^2 — only used to rank/drop parts, units don't matter."""
    a = 0.0
    n = len(ring)
    for i in range(n):
        y1, x1 = ring[i]
        y2, x2 = ring[(i + 1) % n]
        a += x1 * y2 - x2 * y1
    return abs(a) / 2


def geom_rings(geojson_str):
    """GeoJSON geometry -> list of outer rings as [[lat,lng],...], biggest first."""
    g = json.loads(geojson_str)
    polys = []
    if g["type"] == "Polygon":
        polys = [g["coordinates"]]
    elif g["type"] == "MultiPolygon":
        polys = g["coordinates"]
    rings = []
    for poly in polys:
        if not poly:
            continue
        outer = [[round(lat, ROUND), round(lng, ROUND)] for lng, lat, *_ in poly[0]]
        # drop the explicit closing vertex — the convention is an implicit closing edge
        if len(outer) > 1 and outer[0] == outer[-1]:
            outer = outer[:-1]
        if len(outer) >= 3:
            rings.append(outer)
    rings.sort(key=ring_area, reverse=True)
    if not rings:
        return []
    biggest = ring_area(rings[0])
    kept = [r for r in rings if ring_area(r) >= biggest * MIN_PART_FRAC]
    return kept[:MAX_PARTS]


def main():
    dry = "--dry-run" in sys.argv
    tmp = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_dl")
    os.makedirs(tmp, exist_ok=True)

    county_shp = unzip(fetch(f"{BASE}/{COUNTY_ZIP}", os.path.join(tmp, COUNTY_ZIP)),
                       os.path.join(tmp, "county"))
    place_shp = unzip(fetch(f"{BASE}/{PLACE_ZIP}", os.path.join(tmp, PLACE_ZIP)),
                      os.path.join(tmp, "place"))

    con = duckdb.connect()
    con.execute("install spatial; load spatial;")

    counties = con.execute(f"""
        select NAME,
               ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, {TOL_COUNTY})) as gj,
               ST_Y(ST_Centroid(geom)) as clat, ST_X(ST_Centroid(geom)) as clng
        from ST_Read('{county_shp}') where STATEFP = '12'
    """).fetchall()
    print(f"{len(counties)} FL counties")

    # county of each place = which county polygon holds its centroid
    places = con.execute(f"""
        with c as (select NAME as county, geom from ST_Read('{county_shp}') where STATEFP='12'),
             p as (select NAME as name,
                          ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, {TOL_CITY})) as gj,
                          ST_Centroid(geom) as ctr,
                          ST_Y(ST_Centroid(geom)) as clat, ST_X(ST_Centroid(geom)) as clng
                   from ST_Read('{place_shp}'))
        select p.name, p.gj, p.clat, p.clng,
               (select c.county from c where ST_Contains(c.geom, p.ctr) limit 1) as county
        from p
    """).fetchall()
    print(f"{len(places)} FL places (cities + CDPs)")

    rows = []
    for name, gj, clat, clng in counties:
        rings = geom_rings(gj)
        if rings:
            rows.append({"kind": "county", "name": f"{name} County", "county": name,
                         "rings": rings, "center_lat": round(clat, 5), "center_lng": round(clng, 5)})

    # duplicate place names across the state get their county appended
    from collections import Counter
    name_counts = Counter(p[0] for p in places)
    for name, gj, clat, clng, county in places:
        rings = geom_rings(gj)
        if not rings:
            continue
        display = name if name_counts[name] == 1 else f"{name} ({county or 'FL'})"
        rows.append({"kind": "city", "name": display, "county": county,
                     "rings": rings, "center_lat": round(clat, 5), "center_lng": round(clng, 5)})

    total_pts = sum(len(r) for row in rows for r in row["rings"])
    print(f"{len(rows)} rows, {total_pts} vertices total")
    if dry:
        for r in rows[:5]:
            print(r["kind"], r["name"], r["county"], len(r["rings"]), "part(s)",
                  sum(len(x) for x in r["rings"]), "pts")
        return

    key = anon_key()
    CHUNK = 40
    up = 0
    for i in range(0, len(rows), CHUNK):
        chunk = rows[i:i + CHUNK]
        body = json.dumps({"fn": "import_named_areas", "payload": chunk}).encode()
        req = urllib.request.Request(
            f"{SUPABASE_URL}/functions/v1/bulk-load", data=body, method="POST",
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}",
                     "apikey": key, "x-loader-token": LOADER_TOKEN})
        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=120) as r:
                    res = json.loads(r.read())
                up += res.get("upserted", 0)
                break
            except Exception as e:  # noqa: BLE001
                if attempt == 2:
                    raise
                print(f"chunk {i // CHUNK}: {e}; retrying")
                time.sleep(5)
        print(f"chunk {i // CHUNK + 1}/{(len(rows) + CHUNK - 1) // CHUNK} ok ({up} upserted)")
    print(f"done: {up} rows upserted")


if __name__ == "__main__":
    main()
