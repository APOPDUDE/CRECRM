"""Generic ArcGIS REST client: layer metadata, counting, resilient feature
paging, and esriJSON->GeoJSON conversion for servers that can't emit GeoJSON.

Follows the enrich-appraiser conventions: explicit User-Agent, hard
per-request timeout, politeness delay between requests, and loud errors —
a zero-feature response is a fact to report, never silently ignored.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Any, Iterator

import httpx

USER_AGENT = "CRE-CRM enrichment pipeline"
MAX_RETRIES = 3
BACKOFF_S = 2.0  # 2s, 4s, 8s — matches the repo's push-retry convention


class ArcGISError(RuntimeError):
    pass


@dataclass
class LayerInfo:
    name: str
    geometry_type: str | None  # esriGeometryPolygon | ...Polyline | ...Point | None (tables)
    oid_field: str
    max_record_count: int
    supports_pagination: bool
    supports_geojson: bool
    last_edit_ms: int | None
    fields: list[str]


def _request_json(client: httpx.Client, url: str, params: dict[str, Any]) -> dict:
    """GET with retries. ArcGIS servers return HTTP 200 with an embedded
    {"error": ...} body — treat that as a failure too."""
    last: Exception | None = None
    for attempt in range(MAX_RETRIES):
        try:
            resp = client.get(url, params={**params, "f": params.get("f", "json")})
            resp.raise_for_status()
            data = resp.json()
            if isinstance(data, dict) and "error" in data:
                raise ArcGISError(f"{url}: {json.dumps(data['error'])[:300]}")
            return data
        except (httpx.HTTPError, json.JSONDecodeError, ArcGISError) as exc:
            last = exc
            if attempt < MAX_RETRIES - 1:
                time.sleep(BACKOFF_S * (2**attempt))
    raise ArcGISError(f"{url} failed after {MAX_RETRIES} attempts: {last}")


class ArcGISLayer:
    def __init__(self, url: str, timeout_s: float = 30.0, delay_s: float = 0.2):
        self.url = url.rstrip("/")
        self.delay_s = delay_s
        self.client = httpx.Client(
            timeout=timeout_s,
            headers={"User-Agent": USER_AGENT},
            follow_redirects=True,
        )

    def close(self) -> None:
        self.client.close()

    def info(self) -> LayerInfo:
        meta = _request_json(self.client, self.url, {})
        adv = meta.get("advancedQueryCapabilities") or {}
        formats = (meta.get("supportedQueryFormats") or "").lower()
        oid = meta.get("objectIdField")
        if not oid:
            for f in meta.get("fields") or []:
                if f.get("type") == "esriFieldTypeOID":
                    oid = f.get("name")
                    break
        editing = meta.get("editingInfo") or {}
        return LayerInfo(
            name=meta.get("name", ""),
            geometry_type=meta.get("geometryType"),
            oid_field=oid or "OBJECTID",
            max_record_count=int(meta.get("maxRecordCount") or 1000),
            supports_pagination=bool(
                adv.get("supportsPagination", meta.get("supportsPagination", False))
            ),
            supports_geojson="geojson" in formats,
            last_edit_ms=editing.get("lastEditDate"),
            fields=[f.get("name", "") for f in meta.get("fields") or []],
        )

    def _base_params(
        self, where: str, aoi: tuple[float, float, float, float] | None
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"where": where or "1=1"}
        if aoi:
            xmin, ymin, xmax, ymax = aoi
            params.update(
                geometry=f"{xmin},{ymin},{xmax},{ymax}",
                geometryType="esriGeometryEnvelope",
                inSR=4326,
                spatialRel="esriSpatialRelIntersects",
            )
        return params

    def count(
        self, where: str = "1=1", aoi: tuple[float, float, float, float] | None = None
    ) -> int:
        data = _request_json(
            self.client,
            f"{self.url}/query",
            {**self._base_params(where, aoi), "returnCountOnly": "true"},
        )
        return int(data.get("count", 0))

    def iter_features(
        self,
        where: str = "1=1",
        out_fields: str = "*",
        aoi: tuple[float, float, float, float] | None = None,
        page_size: int | None = None,
        info: LayerInfo | None = None,
    ) -> Iterator[dict]:
        """Yield GeoJSON Feature dicts, paged. Prefers resultOffset paging;
        falls back to objectid windows for servers that can't page. Either
        way the server's maxRecordCount is respected."""
        info = info or self.info()
        size = min(page_size or info.max_record_count, info.max_record_count)
        base = self._base_params(where, aoi)
        base.update(outFields=out_fields, outSR=4326, returnGeometry="true")

        if info.supports_pagination:
            yield from self._iter_offset(base, size, info)
        else:
            yield from self._iter_oid_windows(base, size, info)

    def _fetch_page(self, params: dict[str, Any], info: LayerInfo) -> tuple[list[dict], bool]:
        """Returns (features, exceeded_transfer_limit). Servers cap responses
        by byte size as well as row count, so a short page with the exceeded
        flag set means 'more remains', not 'done'."""
        time.sleep(self.delay_s)
        if info.supports_geojson:
            data = _request_json(
                self.client, f"{self.url}/query", {**params, "f": "geojson"}
            )
        else:
            data = _request_json(self.client, f"{self.url}/query", {**params, "f": "json"})
        exceeded = bool(
            data.get("exceededTransferLimit")
            or (data.get("properties") or {}).get("exceededTransferLimit")
        )
        feats = list(data.get("features") or [])
        if not info.supports_geojson:
            gtype = data.get("geometryType") or info.geometry_type
            feats = [esri_feature_to_geojson(f, gtype) for f in feats]
        return feats, exceeded

    def _iter_offset(
        self, base: dict[str, Any], size: int, info: LayerInfo
    ) -> Iterator[dict]:
        offset = 0
        while True:
            page, exceeded = self._fetch_page(
                {**base, "resultOffset": offset, "resultRecordCount": size}, info
            )
            yield from page
            if not page or (len(page) < size and not exceeded):
                return
            offset += len(page)

    def _iter_oid_windows(
        self, base: dict[str, Any], size: int, info: LayerInfo
    ) -> Iterator[dict]:
        data = _request_json(
            self.client,
            f"{self.url}/query",
            {k: v for k, v in base.items() if k not in ("outFields", "returnGeometry")}
            | {"returnIdsOnly": "true"},
        )
        oids = sorted(data.get("objectIds") or [])
        oid_field = data.get("objectIdFieldName") or info.oid_field
        for i in range(0, len(oids), size):
            window = oids[i : i + size]
            page, _ = self._fetch_page(
                {
                    **base,
                    # objectIds beats a BETWEEN where-clause: immune to quoting
                    # and to servers that reject compound where + geometry.
                    "objectIds": ",".join(str(o) for o in window),
                },
                info,
            )
            yield from page


# --- esriJSON -> GeoJSON ----------------------------------------------------
# Only needed for servers whose supportedQueryFormats lacks geoJSON (older
# MapServers). Ring/hole assignment follows the esri spec: clockwise rings are
# exteriors, counter-clockwise rings are holes of whichever exterior contains
# them; orphan holes are promoted to exteriors rather than dropped.


def _ring_area_sign(ring: list[list[float]]) -> float:
    area = 0.0
    for i in range(len(ring) - 1):
        x1, y1 = ring[i][0], ring[i][1]
        x2, y2 = ring[i + 1][0], ring[i + 1][1]
        area += x1 * y2 - x2 * y1
    return area  # >0 counter-clockwise, <0 clockwise


def _point_in_ring(pt: list[float], ring: list[list[float]]) -> bool:
    x, y = pt[0], pt[1]
    inside = False
    for i in range(len(ring) - 1):
        x1, y1 = ring[i][0], ring[i][1]
        x2, y2 = ring[i + 1][0], ring[i + 1][1]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def esri_geometry_to_geojson(geom: dict | None, geometry_type: str | None) -> dict | None:
    if not geom:
        return None
    if geometry_type == "esriGeometryPoint" or "x" in geom:
        if geom.get("x") is None:
            return None
        return {"type": "Point", "coordinates": [geom["x"], geom["y"]]}
    if geometry_type == "esriGeometryMultipoint" or "points" in geom:
        return {"type": "MultiPoint", "coordinates": geom.get("points") or []}
    if geometry_type == "esriGeometryPolyline" or "paths" in geom:
        paths = geom.get("paths") or []
        if not paths:
            return None
        if len(paths) == 1:
            return {"type": "LineString", "coordinates": paths[0]}
        return {"type": "MultiLineString", "coordinates": paths}
    if geometry_type == "esriGeometryPolygon" or "rings" in geom:
        rings = [r for r in (geom.get("rings") or []) if len(r) >= 4]
        if not rings:
            return None
        exteriors = [r for r in rings if _ring_area_sign(r) <= 0]
        holes = [r for r in rings if _ring_area_sign(r) > 0]
        if not exteriors:  # malformed: all rings wound as holes
            exteriors, holes = holes, []
        polys: list[list[list[list[float]]]] = [[ext] for ext in exteriors]
        for hole in holes:
            placed = False
            for poly in polys:
                if _point_in_ring(hole[0], poly[0]):
                    poly.append(hole)
                    placed = True
                    break
            if not placed:
                polys.append([hole])
        if len(polys) == 1:
            return {"type": "Polygon", "coordinates": polys[0]}
        return {"type": "MultiPolygon", "coordinates": polys}
    return None


def esri_feature_to_geojson(feat: dict, geometry_type: str | None) -> dict:
    return {
        "type": "Feature",
        "properties": feat.get("attributes") or {},
        "geometry": esri_geometry_to_geojson(feat.get("geometry"), geometry_type),
    }


# --- server walking (for `discover`) ---------------------------------------


def walk_server(
    root: str, timeout_s: float = 30.0, delay_s: float = 0.2
) -> Iterator[dict]:
    """Yield {url, name, type, geometry_type} for every layer under an ArcGIS
    REST root (recurses folders and services). Root looks like
    https://host/arcgis/rest/services — pass deeper paths to narrow."""
    client = httpx.Client(
        timeout=timeout_s, headers={"User-Agent": USER_AGENT}, follow_redirects=True
    )
    try:
        queue = [root.rstrip("/")]
        seen: set[str] = set()
        while queue:
            url = queue.pop(0)
            if url in seen:
                continue
            seen.add(url)
            time.sleep(delay_s)
            try:
                data = _request_json(client, url, {})
            except ArcGISError:
                continue  # a folder that 500s shouldn't kill the walk
            for folder in data.get("folders") or []:
                queue.append(f"{url}/{folder.rsplit('/', 1)[-1]}")
            for svc in data.get("services") or []:
                name = svc.get("name", "").rsplit("/", 1)[-1]
                stype = svc.get("type", "")
                if stype in ("MapServer", "FeatureServer"):
                    queue.append(f"{url}/{name}/{stype}")
            for layer in (data.get("layers") or []) + (data.get("tables") or []):
                lid = layer.get("id")
                if lid is not None:
                    yield {
                        "url": f"{url}/{lid}",
                        "name": layer.get("name", ""),
                        "type": layer.get("type", ""),
                        "geometry_type": layer.get("geometryType", ""),
                    }
    finally:
        client.close()
