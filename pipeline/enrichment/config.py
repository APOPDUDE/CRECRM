"""Environment + sources.yml loading.

Secrets come from the environment (a pipeline/.env loaded by the caller or
`--env-file`); the repo is public, so nothing secret may have a default here.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

PACKAGE_DIR = Path(__file__).resolve().parent
DEFAULT_SOURCES = PACKAGE_DIR / "sources.yml"

# Tampa Bay six-county envelope (xmin, ymin, xmax, ymax in EPSG:4326) —
# Hillsborough, Pinellas, Pasco, Polk, Manatee, Sarasota. Statewide/national
# sources are clipped to this so the cache stays county-sized.
SIX_COUNTY_AOI = (-83.05, 26.90, -81.05, 28.55)

# properties.county spellings are bare capitalized names (house vocabulary).
COUNTIES = ["Hillsborough", "Pinellas", "Pasco", "Polk", "Manatee", "Sarasota"]

# FIPS for sources keyed by county code (FEMA DFIRM ids, census geographies).
COUNTY_FIPS = {
    "Hillsborough": "12057",
    "Pinellas": "12103",
    "Pasco": "12101",
    "Polk": "12105",
    "Manatee": "12081",
    "Sarasota": "12115",
}


def load_env_file(path: Path) -> None:
    """Tiny .env loader (KEY=VALUE lines) so the job runs from cron without
    a shell wrapper. Existing environment wins — never overrides."""
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


@dataclass
class Settings:
    gis_dsn: str
    supabase_url: str | None
    supabase_service_key: str | None

    @classmethod
    def from_env(cls) -> "Settings":
        dsn = os.environ.get("GIS_PG_DSN", "postgresql://gis:gis@localhost:5433/gis")
        return cls(
            gis_dsn=dsn,
            supabase_url=os.environ.get("SUPABASE_URL") or None,
            supabase_service_key=os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or None,
        )


@dataclass
class Source:
    """One entry under sources.yml `sources:`. url=None is a declared-but-
    unlocated layer — harvest records it loudly as 'unconfigured' instead of
    silently skipping, so the gap stays visible in `enrichment status`."""

    id: str
    url: str | None
    name: str = ""
    kind: str = "arcgis"  # arcgis | sda | fcc_bdc  (sda/fcc handled in a later phase)
    county: str | None = None
    where: str = "1=1"
    out_fields: str = "*"
    clip_aoi: bool = False
    verified: bool = False
    delay_s: float = 0.2
    timeout_s: float = 30.0
    page_size: int | None = None  # cap below the layer's maxRecordCount if set
    notes: str = ""
    discover_hint: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)


def load_sources(path: Path | None = None) -> list[Source]:
    doc = yaml.safe_load((path or DEFAULT_SOURCES).read_text())
    defaults = doc.get("defaults") or {}
    out: list[Source] = []
    seen: set[str] = set()
    for entry in doc.get("sources") or []:
        merged = {**defaults, **entry}
        sid = merged.get("id")
        if not sid:
            raise ValueError(f"sources.yml entry missing id: {entry}")
        if sid in seen:
            raise ValueError(f"sources.yml duplicate id: {sid}")
        seen.add(sid)
        known = {f for f in Source.__dataclass_fields__ if f != "raw"}
        out.append(
            Source(**{k: v for k, v in merged.items() if k in known}, raw=merged)
        )
    return out
