"""Local PostGIS cache access: schema bootstrap, staged layer swaps, parcels."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterable

import psycopg
from psycopg.types.json import Jsonb

SCHEMA_SQL = Path(__file__).resolve().parent / "sql" / "gis_schema.sql"


def connect(dsn: str) -> psycopg.Connection:
    conn = psycopg.connect(dsn, autocommit=False)
    # Works against both targets: hosted Supabase (postgis lives in the
    # `extensions` schema; role-default statement_timeout is short) and the
    # local Docker cache (nonexistent schemas in search_path are ignored).
    # Staged swaps and spatial joins legitimately run minutes.
    conn.execute("set search_path = gis, public, extensions")
    conn.execute("set statement_timeout = '600s'")
    conn.commit()
    return conn


def init_schema(conn: psycopg.Connection) -> None:
    """Idempotent: every statement in gis_schema.sql is IF NOT EXISTS."""
    conn.execute(SCHEMA_SQL.read_text())
    conn.commit()


def upsert_layer(conn: psycopg.Connection, source_id: str, **cols: Any) -> None:
    cols = {"source_id": source_id, **cols}
    names = ", ".join(cols)
    placeholders = ", ".join(f"%({k})s" for k in cols)
    updates = ", ".join(f"{k} = excluded.{k}" for k in cols if k != "source_id")
    conn.execute(
        f"insert into gis.layers ({names}) values ({placeholders}) "
        f"on conflict (source_id) do update set {updates}",
        {k: (Jsonb(v) if k == "detail" else v) for k, v in cols.items()},
    )
    conn.commit()


def ensure_layer(
    conn: psycopg.Connection, source_id: str, url: str | None, kind: str, county: str | None
) -> None:
    """Make the registry row exist (FK target for features) without touching
    an existing row's status/watermark."""
    conn.execute(
        "insert into gis.layers (source_id, url, kind, county) values (%s, %s, %s, %s) "
        "on conflict (source_id) do nothing",
        (source_id, url, kind, county),
    )
    conn.commit()


def get_layer(conn: psycopg.Connection, source_id: str) -> dict | None:
    cur = conn.execute(
        "select source_id, url, county, last_edit_ms, source_count, feature_count, "
        "harvested_at, status from gis.layers where source_id = %s",
        (source_id,),
    )
    row = cur.fetchone()
    if not row:
        return None
    keys = [d.name for d in cur.description]
    return dict(zip(keys, row))


def start_run(conn: psycopg.Connection, source_id: str) -> int:
    cur = conn.execute(
        "insert into gis.harvest_runs (source_id) values (%s) returning id",
        (source_id,),
    )
    run_id = cur.fetchone()[0]
    conn.commit()
    return run_id


def finish_run(
    conn: psycopg.Connection,
    run_id: int,
    status: str,
    features: int | None = None,
    message: str | None = None,
) -> None:
    conn.execute(
        "update gis.harvest_runs set finished_at = now(), status = %s, "
        "features = %s, message = %s where id = %s",
        (status, features, message, run_id),
    )
    conn.commit()


def stage_features(
    conn: psycopg.Connection,
    source_id: str,
    features: Iterable[dict],
    oid_field: str,
    batch_size: int = 500,
) -> int:
    """Load GeoJSON features into the stage table. Runs inside the caller's
    open transaction — nothing touches live rows until swap_stage()."""
    conn.execute(
        "delete from gis.layer_features_stage where source_id = %s", (source_id,)
    )
    total = 0
    batch: list[tuple] = []

    def flush() -> None:
        nonlocal total
        if not batch:
            return
        with conn.cursor() as cur:
            cur.executemany(
                # ST_MakeValid: county layers routinely carry self-intersecting
                # rings; ST_Force2D: some servers emit Z which 5070 math trips on.
                "insert into gis.layer_features_stage "
                "  (source_id, source_oid, attrs, geom, geom_5070) "
                "select %s, %s, %s::jsonb, g, st_transform(g, 5070) from ("
                "  select case when %s::text is null then null "
                "    else st_makevalid(st_force2d(st_setsrid(st_geomfromgeojson(%s::text), 4326))) "
                "  end as g) s "
                "on conflict (source_id, source_oid) do nothing",
                batch,
            )
        total += len(batch)
        batch.clear()

    for feat in features:
        props = feat.get("properties") or {}
        oid = feat.get("id", props.get(oid_field))
        if oid is None:
            continue  # a feature the server won't identify can't be upserted
        geom = feat.get("geometry")
        geom_json = json.dumps(geom) if geom else None
        batch.append((source_id, int(oid), json.dumps(props), geom_json, geom_json))
        if len(batch) >= batch_size:
            flush()
    flush()
    return total


def swap_stage(conn: psycopg.Connection, source_id: str) -> int:
    """Atomically replace the live copy of a layer with the staged one.
    Caller commits — the delete+insert+bookkeeping is one transaction, so a
    failure anywhere leaves the previous good copy in place."""
    conn.execute("delete from gis.layer_features where source_id = %s", (source_id,))
    cur = conn.execute(
        "insert into gis.layer_features "
        "select * from gis.layer_features_stage where source_id = %s",
        (source_id,),
    )
    count = cur.rowcount
    conn.execute(
        "delete from gis.layer_features_stage where source_id = %s", (source_id,)
    )
    return count


def upsert_parcel(
    conn: psycopg.Connection,
    property_id: str,
    county: str,
    parcel_number: str | None,
    match_method: str,
    matched_value: str,
    geom_geojson: dict,
) -> None:
    conn.execute(
        "insert into gis.parcels "
        "  (property_id, county, parcel_number, match_method, matched_value, "
        "   geom, geom_5070, acres_gis, fetched_at) "
        "select %s, %s, %s, %s, %s, g, st_transform(g, 5070), "
        "       st_area(st_transform(g, 5070)) / 4046.8564224, now() "
        "from (select st_multi(st_makevalid(st_force2d(st_setsrid("
        "       st_geomfromgeojson(%s), 4326)))) as g) s "
        "on conflict (property_id) do update set "
        "  county = excluded.county, parcel_number = excluded.parcel_number, "
        "  match_method = excluded.match_method, matched_value = excluded.matched_value, "
        "  geom = excluded.geom, geom_5070 = excluded.geom_5070, "
        "  acres_gis = excluded.acres_gis, fetched_at = excluded.fetched_at",
        (
            property_id,
            county,
            parcel_number,
            match_method,
            matched_value,
            json.dumps(geom_geojson),
        ),
    )


def parcels_missing(conn: psycopg.Connection, property_ids: list[str]) -> set[str]:
    """Which of these uuids have no cached polygon yet (idempotent re-runs
    skip work already done)."""
    if not property_ids:
        return set()
    cur = conn.execute(
        "select property_id::text from gis.parcels where property_id = any(%s::uuid[])",
        (property_ids,),
    )
    have = {r[0] for r in cur.fetchall()}
    return {p for p in property_ids if p not in have}
