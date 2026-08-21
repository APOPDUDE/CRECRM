"""Supabase access over PostgREST — the house pattern for external writers:
service-role key + REST/RPC, never a direct Postgres wire into the hosted DB.
Reads are keyset-paged (order=id, id=gt.<last>) behind the 1000-row cap;
OFFSET paging is banned (it blew the 8s statement timeout, 2026-08-16).
"""

from __future__ import annotations

from typing import Iterator

import httpx

PAGE = 1000


class SupabaseError(RuntimeError):
    pass


class Supabase:
    def __init__(self, url: str, service_key: str, timeout_s: float = 30.0):
        if not url or not service_key:
            raise SupabaseError(
                "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required "
                "(pipeline/.env — see pipeline/.env.example)"
            )
        self.rest = url.rstrip("/") + "/rest/v1"
        self.client = httpx.Client(
            timeout=timeout_s,
            headers={
                "apikey": service_key,
                "Authorization": f"Bearer {service_key}",
                "User-Agent": "CRE-CRM enrichment pipeline",
            },
        )

    def close(self) -> None:
        self.client.close()

    def iter_rows(self, table: str, select: str, filters: dict[str, str]) -> Iterator[dict]:
        if "id" in filters:
            # the keyset cursor owns the id param — an id filter would be
            # silently replaced from page 2 on
            raise SupabaseError("iter_rows: filter on 'id' is reserved for the keyset cursor")
        last_id: str | None = None
        while True:
            params = {
                **filters,
                "select": select,
                "order": "id.asc",
                "limit": str(PAGE),
            }
            if last_id:
                params["id"] = f"gt.{last_id}"
            resp = self.client.get(f"{self.rest}/{table}", params=params)
            if resp.status_code >= 400:
                raise SupabaseError(f"{table}: HTTP {resp.status_code} {resp.text[:300]}")
            rows = resp.json()
            yield from rows
            if len(rows) < PAGE:
                return
            last_id = rows[-1]["id"]

    def rpc(self, fn: str, payload: dict) -> dict | list:
        resp = self.client.post(f"{self.rest}/rpc/{fn}", json=payload)
        if resp.status_code >= 400:
            raise SupabaseError(f"rpc/{fn}: HTTP {resp.status_code} {resp.text[:300]}")
        return resp.json()


def tracked_book(sb: Supabase, counties: list[str], county: str | None = None) -> list[dict]:
    """The parcels the pipeline enriches: every property in the adapter
    counties. Narrow column slice, per the book-fetch convention."""
    wanted = [county] if county else counties
    quoted = ",".join(f'"{c}"' for c in wanted)
    return list(
        sb.iter_rows(
            "properties",
            select="id,county,parcel_number,folio,lat,lng,land_acres",
            filters={"county": f"in.({quoted})"},
        )
    )
