"""CLI entry point.

    enrichment init-db                 create/upgrade the local gis schema
    enrichment harvest [...]           walk sources.yml into the cache
    enrichment parcels [...]           fetch tracked-book parcel polygons
    enrichment discover <root> [...]   emit sources.yml stubs from a server
    enrichment status                  what's cached, how fresh, what's missing
    enrichment join|score|push         phase 2 — stubs that name the plan

Every command is idempotent: re-running does no duplicate work and never
degrades cached data (failed sources freeze at their last good copy).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import db
from .config import Settings, load_env_file, load_sources


def _conn(settings: Settings):
    connection = db.connect(settings.gis_dsn)
    db.init_schema(connection)
    return connection


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="enrichment", description=__doc__)
    parser.add_argument(
        "--env-file",
        type=Path,
        default=Path(__file__).resolve().parent.parent / ".env",
        help="KEY=VALUE file loaded before reading settings (default pipeline/.env)",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("init-db", help="create/upgrade the local gis schema")

    p_harvest = sub.add_parser("harvest", help="harvest configured layers")
    p_harvest.add_argument("--source", help="one source id only")
    p_harvest.add_argument("--county", help="bare county name filter (e.g. Pasco)")
    p_harvest.add_argument("--force", action="store_true", help="ignore watermarks")
    p_harvest.add_argument("--sources-file", type=Path, help="alternate sources.yml")

    p_parcels = sub.add_parser("parcels", help="fetch tracked-book parcel polygons")
    p_parcels.add_argument("--county", help="bare county name (e.g. Hillsborough)")
    p_parcels.add_argument(
        "--refresh", action="store_true", help="re-fetch even already-cached parcels"
    )

    p_disc = sub.add_parser("discover", help="walk an ArcGIS server, emit source stubs")
    p_disc.add_argument("root", help="server root, e.g. https://host/arcgis/rest/services")
    p_disc.add_argument("-k", "--keywords", help="comma-separated layer-name keywords")
    p_disc.add_argument("--county", help="stamp stubs with this county")

    sub.add_parser("status", help="cache freshness + gaps report")

    for name in ("join", "score", "push"):
        sub.add_parser(name, help="phase 2 (schema + harvester ship first)")

    args = parser.parse_args(argv)
    load_env_file(args.env_file)
    settings = Settings.from_env()

    if args.command == "init-db":
        conn = _conn(settings)
        conn.close()
        print("gis schema ready")
        return 0

    if args.command == "harvest":
        from .harvester import harvest_all

        sources = load_sources(getattr(args, "sources_file", None))
        if args.source and args.source not in {s.id for s in sources}:
            # a typo'd --source in a cron line must never be silently green
            print(f"error: no source '{args.source}' in sources.yml", file=sys.stderr)
            return 1
        conn = _conn(settings)
        try:
            results = harvest_all(
                conn, sources, only=args.source, county=args.county, force=args.force
            )
        finally:
            conn.close()
        if not results:
            print(f"error: no sources matched --county {args.county}", file=sys.stderr)
            return 1
        bad = [r for r in results if r.status == "error"]
        return 1 if bad else 0

    if args.command == "parcels":
        from .parcels import COUNTY_PARCEL_LAYERS, fetch_parcels
        from .supabase_api import Supabase

        if args.county and args.county not in COUNTY_PARCEL_LAYERS:
            print(
                f"error: no parcel layer for '{args.county}' — "
                f"one of {', '.join(sorted(COUNTY_PARCEL_LAYERS))} (bare name)",
                file=sys.stderr,
            )
            return 1
        sb = Supabase(settings.supabase_url or "", settings.supabase_service_key or "")
        conn = _conn(settings)
        try:
            fetch_parcels(conn, sb, county=args.county, refresh=args.refresh)
        finally:
            conn.close()
            sb.close()
        return 0

    if args.command == "discover":
        from .discover import discover

        keywords = args.keywords.split(",") if args.keywords else None
        discover(args.root, keywords, args.county)
        return 0

    if args.command == "status":
        conn = _conn(settings)
        try:
            cur = conn.execute(
                "select source_id, status, feature_count, "
                "  to_char(harvested_at, 'YYYY-MM-DD HH24:MI') as harvested "
                "from gis.layers order by status, source_id"
            )
            rows = cur.fetchall()
            if not rows:
                print("nothing cached yet — run: enrichment harvest")
            for source_id, status, count, harvested in rows:
                print(f"[{status:>12}] {source_id:<32} features={count or 0:<8} {harvested or ''}")
            cur = conn.execute(
                "select county, count(*), sum((match_method='point_in_polygon')::int) "
                "from gis.parcels group by county order by county"
            )
            for county, total, by_point in cur.fetchall():
                print(f"parcels {county}: {total} cached ({by_point} via point fallback)")
        finally:
            conn.close()
        return 0

    if args.command in ("join", "score", "push"):
        print(
            f"'{args.command}' is phase 2 — the plan (spatial joins in EPSG:5070, "
            "score from enrichment_score_weights, push via import_parcel_enrichment "
            "with per-domain freshness) is in context/land-book-parcel-enrichment.md. "
            "Schema + harvester ship first, per Alex 2026-08-21."
        )
        return 2

    return 0


if __name__ == "__main__":
    sys.exit(main())
