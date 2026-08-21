"""Parcel polygon fetcher — the foundation every spatial join stands on.

Pulls the tracked book from Supabase, then fetches each parcel's POLYGON from
its county's parcel layer. The county endpoints, id fields and normalization
rules mirror supabase/functions/enrich-appraiser/index.ts COUNTIES — this is
a third copy of that adapter knowledge (edge fn, properties-map.tsx, here);
keep them in lockstep until the registry is consolidated.

Matching order (parcel ids are resolvers, not keys — dupes, comma-lists,
~20% county-key mismatch):
  1. id match against the county layer (chunked WHERE field IN (...)),
     assemblage comma-lists fetch ALL their ids and union the shapes;
  2. point-in-polygon at the property's lat/lng for whatever is left;
  3. still unmatched -> reported loudly, never guessed.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass
from typing import Callable

import psycopg
from shapely.geometry import mapping, shape
from shapely.ops import unary_union

from . import db
from .arcgis import ArcGISLayer, LayerInfo, _request_json, esri_feature_to_geojson
from .supabase_api import Supabase, tracked_book

ID_CHUNK = 40  # ids per WHERE IN query — keeps URLs under proxy limits


def _digits(v: str) -> str:
    return re.sub(r"\D", "", v or "")


def _grouped(digits: str, pattern: list[int], sep: str) -> str | None:
    """Rebuild a county's separator format from bare digits — the same digit
    groupings src/lib/parcel.ts formatParcelId uses. None when the digit count
    doesn't fit (never mangle a valid-but-different id)."""
    if len(digits) != sum(pattern):
        return None
    parts, i = [], 0
    for width in pattern:
        parts.append(digits[i : i + width])
        i += width
    return sep.join(parts)


def _pinellas(p: str) -> tuple[str, str]:
    # DISPLAY_STRAP is dashed (15-29-15-64890-004-0010). Stored values drift
    # in punctuation, so rebuild the dashes from bare digits when possible.
    p = p.strip()
    if "-" not in p:
        rebuilt = _grouped(_digits(p), [2, 2, 2, 5, 3, 4], "-")
        if rebuilt:
            return ("DISPLAY_STRAP", rebuilt)
    return ("DISPLAY_STRAP", p)


def _pasco(p: str) -> tuple[str, str]:
    # VPARCEL is space-separated; stored values are usually dashed.
    p = re.sub(r"\s+", " ", p.strip().replace("-", " "))
    if " " not in p:
        rebuilt = _grouped(_digits(p), [2, 2, 2, 4, 5, 4], " ")
        if rebuilt:
            return ("VPARCEL", rebuilt)
    return ("VPARCEL", p)


@dataclass
class CountyParcels:
    url: str
    id_field: str
    # normalize: our stored parcel id -> (query_field, query_value)
    normalize: Callable[[str], tuple[str, str]]


# Endpoints verbatim from enrich-appraiser/index.ts (field-proven in prod).
COUNTY_PARCEL_LAYERS: dict[str, CountyParcels] = {
    "Polk": CountyParcels(
        "https://gis.polk-county.net/server/rest/services/Map_Property_Appraiser/MapServer/1",
        "PARCELID",
        lambda p: ("PARCELID", _digits(p)),
    ),
    "Pinellas": CountyParcels(
        "https://egis.pinellas.gov/pcpagis/rest/services/Pcpao_gov/PropertyPopup_A/MapServer/0",
        "DISPLAY_STRAP",
        _pinellas,
    ),
    "Sarasota": CountyParcels(
        "https://services3.arcgis.com/icrWMv7eBkctFu1f/arcgis/rest/services/ParcelHosted/FeatureServer/0",
        "ID",
        lambda p: ("ID", _digits(p)),
    ),
    "Pasco": CountyParcels(
        "https://pascogis.pascocountyfl.net/gisweb/rest/services/PascoView/PascoMapper_R_OP/MapServer/7",
        "VPARCEL",
        _pasco,
    ),
    "Manatee": CountyParcels(
        "https://gis.manateepao.com/arcgis/rest/services/Website/WebLayers/MapServer/0",
        "PARID",
        lambda p: ("PARID", _digits(p)),
    ),
    "Hillsborough": CountyParcels(
        "https://maps.hillsboroughcounty.org/arcgis/rest/services/InfoLayers/HC_Parcels/FeatureServer/0",
        "PIN",
        # Letter prefix = PIN; bare digits = the 10-digit FOLIO.
        lambda p: ("PIN", p.strip().upper())
        if re.search(r"[A-Za-z]", p)
        else ("FOLIO", _digits(p)),
    ),
}


@dataclass
class FetchStats:
    matched_id: int = 0
    matched_point: int = 0
    unmatched: int = 0
    skipped_cached: int = 0
    unmatched_ids: list[str] = None  # first few, for the loud report

    def __post_init__(self):
        if self.unmatched_ids is None:
            self.unmatched_ids = []


def _union_geojson(geoms: list[dict]) -> dict | None:
    shapes = [shape(g) for g in geoms if g]
    shapes = [s.buffer(0) if not s.is_valid else s for s in shapes]
    shapes = [s for s in shapes if not s.is_empty]
    if not shapes:
        return None
    merged = unary_union(shapes)
    return mapping(merged)


def _query_by_ids(
    layer: ArcGISLayer, info: LayerInfo, field: str, values: list[str]
) -> list[dict]:
    quoted = ",".join("'" + v.replace("'", "''") + "'" for v in values)
    return list(
        layer.iter_features(where=f"{field} IN ({quoted})", out_fields="*", info=info)
    )


def _query_by_point(
    layer: ArcGISLayer, info: LayerInfo, lat: float, lng: float, delay_s: float
) -> list[dict]:
    time.sleep(delay_s)
    params = {
        "geometry": f"{lng},{lat}",
        "geometryType": "esriGeometryPoint",
        "inSR": 4326,
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "*",
        "outSR": 4326,
        "returnGeometry": "true",
        "where": "1=1",
    }
    if info.supports_geojson:
        data = _request_json(layer.client, f"{layer.url}/query", {**params, "f": "geojson"})
        return list(data.get("features") or [])
    data = _request_json(layer.client, f"{layer.url}/query", {**params, "f": "json"})
    return [
        esri_feature_to_geojson(f, data.get("geometryType") or info.geometry_type)
        for f in data.get("features") or []
    ]


def fetch_county(
    conn: psycopg.Connection,
    county: str,
    rows: list[dict],
    refresh: bool = False,
    delay_s: float = 0.2,
) -> FetchStats:
    adapter = COUNTY_PARCEL_LAYERS[county]
    stats = FetchStats()

    if not refresh:
        missing = db.parcels_missing(conn, [r["id"] for r in rows])
        stats.skipped_cached = len(rows) - len(missing)
        rows = [r for r in rows if r["id"] in missing]
    if not rows:
        return stats

    layer = ArcGISLayer(adapter.url, delay_s=delay_s)
    try:
        info = layer.info()
        # --- pass 1: by parcel id -------------------------------------------
        # Assemblage comma-lists contribute EVERY id and get the shapes
        # unioned. Two match tiers per returned feature: exact attr value,
        # then digits-only (id_normalized) — county formatting drifts.
        pieces: dict[str, int] = {}  # property_id -> ids this row wants
        want_exact: dict[tuple[str, str], list[tuple[dict, str]]] = {}
        want_digits: dict[tuple[str, str], list[tuple[dict, str]]] = {}
        for row in rows:
            raw = row.get("parcel_number") or row.get("folio") or ""
            for piece in [p.strip() for p in raw.split(",") if p.strip()]:
                field, value = adapter.normalize(piece)
                if not value:
                    continue
                pieces[row["id"]] = pieces.get(row["id"], 0) + 1
                want_exact.setdefault((field, value), []).append((row, value))
                dv = _digits(value)
                if dv:
                    want_digits.setdefault((field, dv), []).append((row, value))

        found: dict[str, list[dict]] = {}   # property_id -> feature geometries
        found_vals: dict[str, list[str]] = {}
        found_exact: dict[str, bool] = {}
        by_field: dict[str, list[str]] = {}
        for (field, value), _entries in want_exact.items():
            by_field.setdefault(field, []).append(value)
        for field, values in by_field.items():
            for i in range(0, len(values), ID_CHUNK):
                chunk = values[i : i + ID_CHUNK]
                for feat in _query_by_ids(layer, info, field, chunk):
                    if not feat.get("geometry"):
                        continue
                    attr = str((feat.get("properties") or {}).get(field, "")).strip()
                    hits = want_exact.get((field, attr))
                    exact = hits is not None
                    if hits is None:
                        hits = want_digits.get((field, _digits(attr))) or []
                    for row, value in hits:
                        found.setdefault(row["id"], []).append(feat["geometry"])
                        found_vals.setdefault(row["id"], []).append(value)
                        found_exact[row["id"]] = found_exact.get(row["id"], True) and exact

        stored: set[str] = set()
        for row in rows:
            geoms = found.get(row["id"])
            if not geoms:
                continue
            merged = _union_geojson(geoms)
            if not merged:
                continue  # degenerate shapes fall through to the point pass
            vals = list(dict.fromkeys(found_vals[row["id"]]))
            matched = ",".join(vals)[:180]
            wanted_n = pieces.get(row["id"], len(vals))
            if len(vals) < wanted_n:
                # a partial assemblage under-covers: say so in the provenance
                matched += f" ({len(vals)}/{wanted_n} ids)"
            db.upsert_parcel(
                conn, row["id"], county, row.get("parcel_number"),
                "id_exact" if found_exact.get(row["id"], True) else "id_normalized",
                matched, merged,
            )
            stored.add(row["id"])
            stats.matched_id += 1
        conn.commit()

        # --- pass 2: point-in-polygon fallback ------------------------------
        for row in rows:
            if row["id"] in stored:
                continue
            lat, lng = row.get("lat"), row.get("lng")
            merged = None
            if lat is not None and lng is not None:
                feats = [
                    f for f in _query_by_point(layer, info, lat, lng, delay_s)
                    if f.get("geometry")
                ]
                if feats:
                    merged = _union_geojson([feats[0]["geometry"]])
            if not merged:
                stats.unmatched += 1
                if len(stats.unmatched_ids) < 20:
                    stats.unmatched_ids.append(row["id"])
                continue
            db.upsert_parcel(
                conn, row["id"], county, row.get("parcel_number"),
                "point_in_polygon", f"{lat},{lng}", merged,
            )
            stats.matched_point += 1
        conn.commit()
    finally:
        layer.close()
    return stats


def fetch_parcels(
    conn: psycopg.Connection,
    sb: Supabase,
    county: str | None = None,
    refresh: bool = False,
) -> dict[str, FetchStats]:
    book = tracked_book(sb, list(COUNTY_PARCEL_LAYERS), county)
    by_county: dict[str, list[dict]] = {}
    for row in book:
        if row.get("county") in COUNTY_PARCEL_LAYERS:
            by_county.setdefault(row["county"], []).append(row)

    results: dict[str, FetchStats] = {}
    for cty, rows in sorted(by_county.items()):
        try:
            stats = fetch_county(conn, cty, rows, refresh=refresh)
        except Exception as exc:
            # one county's dead server must not abort the other five;
            # committed passes for this county are already safe
            conn.rollback()
            print(f"{cty}: FAILED — {type(exc).__name__}: {exc}")
            continue
        results[cty] = stats
        print(
            f"{cty}: id={stats.matched_id} point={stats.matched_point} "
            f"unmatched={stats.unmatched} cached={stats.skipped_cached}"
            + (f"  first unmatched: {stats.unmatched_ids[:5]}" if stats.unmatched else "")
        )
    return results
