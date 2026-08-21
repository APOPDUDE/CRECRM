"""The idempotent layer harvester.

Walks sources.yml, and for each ArcGIS source:
  1. reads layer metadata + server-side count (the watermark),
  2. skips when nothing changed since the last successful harvest,
  3. pages every feature into gis.layer_features_stage,
  4. atomically swaps stage -> live and stamps the watermark, in ONE
     transaction — a failure at any point leaves the previous good copy
     untouched (freeze, don't decay; the sweep_finalize_off_market lesson).

Every attempt lands in gis.harvest_runs and gis.layers.status, loudly —
including empties, errors, and sources that have no URL yet.
"""

from __future__ import annotations

import time
import traceback
from dataclasses import dataclass

import psycopg

from . import db
from .arcgis import ArcGISError, ArcGISLayer
from .config import SIX_COUNTY_AOI, Source


@dataclass
class HarvestResult:
    source_id: str
    status: str  # ok | empty | error | skipped | unconfigured
    features: int = 0
    message: str = ""


def harvest_source(
    conn: psycopg.Connection, source: Source, force: bool = False
) -> HarvestResult:
    if source.kind != "arcgis":
        # sda / fcc_bdc land in the joins phase; declared now so the catalog
        # and the status report show the full plan, not just what's built.
        db.upsert_layer(
            conn, source.id, url=source.url, kind=source.kind, county=source.county,
            status="unconfigured",
            detail={"reason": f"kind {source.kind} not implemented yet"},
        )
        return HarvestResult(source.id, "unconfigured", message=f"kind={source.kind}")

    if not source.url:
        db.upsert_layer(
            conn, source.id, url=None, kind=source.kind, county=source.county,
            status="unconfigured",
            detail={"reason": "no url yet", "discover_hint": source.discover_hint},
        )
        return HarvestResult(
            source.id, "unconfigured",
            message=f"no url — run: enrichment discover {source.discover_hint or '<server root>'}",
        )

    db.ensure_layer(conn, source.id, source.url, source.kind, source.county)
    run_id = db.start_run(conn, source.id)
    layer = ArcGISLayer(source.url, timeout_s=source.timeout_s, delay_s=source.delay_s)
    aoi = SIX_COUNTY_AOI if source.clip_aoi else None
    started = time.monotonic()
    try:
        info = layer.info()
        count = layer.count(where=source.where, aoi=aoi)

        prev = db.get_layer(conn, source.id)
        unchanged = (
            prev is not None
            and prev["status"] == "ok"
            and prev["source_count"] == count
            and prev["last_edit_ms"] == info.last_edit_ms
            # a service that reports no lastEditDate can only watermark on
            # count, which misses edit-in-place — refresh those when stale.
            and (info.last_edit_ms is not None or _fresh(conn, source.id))
        )
        if unchanged and not force:
            db.finish_run(conn, run_id, "skipped", prev["feature_count"], "watermark unchanged")
            return HarvestResult(
                source.id, "skipped", prev["feature_count"] or 0, "watermark unchanged"
            )

        if count == 0:
            # A zero count is a fact to report, never an instruction to wipe
            # the cached copy: keep live rows, mark the layer loudly.
            db.upsert_layer(
                conn, source.id, url=source.url, kind=source.kind, county=source.county,
                last_edit_ms=info.last_edit_ms, source_count=0, status="empty",
                detail={"where": source.where, "clip_aoi": source.clip_aoi},
            )
            db.finish_run(conn, run_id, "empty", 0, "server-side count = 0")
            return HarvestResult(source.id, "empty", 0, "server-side count = 0")

        staged = db.stage_features(
            conn,
            source.id,
            layer.iter_features(
                where=source.where,
                out_fields=source.out_fields,
                aoi=aoi,
                page_size=source.page_size,
                info=info,
            ),
            oid_field=info.oid_field,
        )
        if staged == 0:
            conn.rollback()
            db.finish_run(conn, run_id, "error", 0, f"count={count} but 0 features paged")
            return HarvestResult(
                source.id, "error", 0, f"count={count} but 0 features paged"
            )

        # Reconcile staged rows against the server-side count before swapping:
        # a transfer-limit truncation or paging quirk must never replace a
        # complete cached copy with a partial one. 5% slack absorbs edits that
        # land mid-harvest; over-count is impossible (stage PK dedupes).
        staged_rows = conn.execute(
            "select count(*) from gis.layer_features_stage where source_id = %s",
            (source.id,),
        ).fetchone()[0]
        if staged_rows < count * 0.95:
            conn.rollback()
            message = f"staged {staged_rows} of server-count {count} — refusing partial swap"
            db.upsert_layer(
                conn, source.id, url=source.url, kind=source.kind, county=source.county,
                status="error", detail={"error": message},
            )
            db.finish_run(conn, run_id, "error", staged_rows, message)
            return HarvestResult(source.id, "error", 0, message)

        swapped = db.swap_stage(conn, source.id)
        # upsert_layer commits: the swap + watermark land atomically.
        db.upsert_layer(
            conn, source.id, url=source.url, kind=source.kind, county=source.county,
            geom_type=info.geometry_type, last_edit_ms=info.last_edit_ms,
            source_count=count, feature_count=swapped,
            harvested_at=_now(conn), status="ok",
            detail={
                "where": source.where,
                "clip_aoi": source.clip_aoi,
                "oid_field": info.oid_field,
                "seconds": round(time.monotonic() - started, 1),
            },
        )
        db.finish_run(conn, run_id, "ok", swapped)
        return HarvestResult(source.id, "ok", swapped)

    except (ArcGISError, psycopg.Error) as exc:
        conn.rollback()
        message = f"{type(exc).__name__}: {exc}"
        db.upsert_layer(
            conn, source.id, url=source.url, kind=source.kind, county=source.county,
            status="error", detail={"error": message[:500]},
        )
        db.finish_run(conn, run_id, "error", None, message[:500])
        return HarvestResult(source.id, "error", 0, message)
    except Exception as exc:  # never let one bad layer kill the whole walk
        conn.rollback()
        message = f"{type(exc).__name__}: {exc}\n{traceback.format_exc(limit=3)}"
        try:
            # status must go red in gis.layers too, or `enrichment status`
            # keeps reporting the stale [ok] from the previous run
            db.upsert_layer(
                conn, source.id, url=source.url, kind=source.kind, county=source.county,
                status="error", detail={"error": message[:500]},
            )
        except Exception:
            conn.rollback()
        db.finish_run(conn, run_id, "error", None, message[:500])
        return HarvestResult(source.id, "error", 0, message)
    finally:
        layer.close()


def _fresh(conn: psycopg.Connection, source_id: str, max_age_days: int = 7) -> bool:
    cur = conn.execute(
        "select harvested_at > now() - make_interval(days => %s) "
        "from gis.layers where source_id = %s",
        (max_age_days, source_id),
    )
    row = cur.fetchone()
    return bool(row and row[0])


def _now(conn: psycopg.Connection):
    return conn.execute("select now()").fetchone()[0]


def harvest_all(
    conn: psycopg.Connection,
    sources: list[Source],
    only: str | None = None,
    county: str | None = None,
    force: bool = False,
) -> list[HarvestResult]:
    results = []
    for source in sources:
        if only and source.id != only:
            continue
        if county and source.county and source.county != county:
            continue
        result = harvest_source(conn, source, force=force)
        print(
            f"[{result.status:>12}] {result.source_id}"
            f"  features={result.features}  {result.message}"
        )
        results.append(result)
    return results
