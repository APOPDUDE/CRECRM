"""`enrichment discover` — walk any ArcGIS server root and emit sources.yml
stubs for layers matching keywords. This is how county utility/FLU layers get
catalogued without hand-hunting through map viewers.
"""

from __future__ import annotations

import re

from .arcgis import walk_server

DEFAULT_KEYWORDS = [
    "water main", "sewer", "force main", "gravity", "reclaimed",
    "hydrant", "lift station", "service area", "utility",
    "future land use", "flu", "zoning",
    "substation", "transmission",
]


def _slug(text: str) -> str:
    return re.sub(r"_+", "_", re.sub(r"[^a-z0-9]+", "_", text.lower())).strip("_")


def discover(root: str, keywords: list[str] | None = None, county: str | None = None) -> None:
    keywords = [k.strip().lower() for k in (keywords or DEFAULT_KEYWORDS) if k.strip()]
    hits = 0
    for layer in walk_server(root):
        name = layer["name"].lower()
        matched = [k for k in keywords if k in name]
        if not matched:
            continue
        hits += 1
        print(f"  # matched: {', '.join(matched)}  ({layer['geometry_type'] or layer['type']})")
        print(f"  - id: {_slug((county or '') + '_' + layer['name'])}")
        print(f"    name: {layer['name']}")
        print("    kind: arcgis")
        print(f"    url: {layer['url']}")
        if county:
            print(f"    county: {county}")
        print("    verified: false   # confirm with a harvest")
        print()
    if hits == 0:
        print(f"# no layers under {root} matched {keywords}")
        print("# (try -k with broader keywords, or a deeper folder path)")
