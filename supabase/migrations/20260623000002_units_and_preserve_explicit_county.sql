-- Available units for multi-tenant properties + a prospect<->unit link, and a fix so a
-- manually-set county survives when a property has no city (needed for parcel-only adds
-- to enrich: county is what picks the appraiser adapter).

-- 1) Units: sub-spaces of a property available for lease (suites, pads, acreage).
create table public.units (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  label text,
  size_sf integer,
  size_acres numeric(10,2),
  asking_rate_psf numeric(10,2),
  status text not null default 'available' check (status in ('available','leased')),
  created_at timestamptz not null default now()
);
create index on public.units (property_id);

-- 2) Which units a prospect (pursuit) inquired on — many-to-many.
create table public.pursuit_units (
  pursuit_id uuid not null references public.pursuits(id) on delete cascade,
  unit_id    uuid not null references public.units(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (pursuit_id, unit_id)
);
create index on public.pursuit_units (unit_id);

-- RLS: match the rest of the app (authenticated full access).
alter table public.units enable row level security;
create policy units_auth_all on public.units for all to authenticated using (true) with check (true);
alter table public.pursuit_units enable row level security;
create policy pursuit_units_auth_all on public.pursuit_units for all to authenticated using (true) with check (true);

-- 3) Trigger fix: only derive county FROM city when a city is present. Previously county
-- was always recomputed (→ null when city is null), which wiped an explicitly-provided
-- county on parcel-only manual adds and blocked enrichment. Now an explicit county is kept.
create or replace function public.set_property_county()
returns trigger language plpgsql as $function$
begin
  if new.city is not null then
    new.city := nullif(btrim(regexp_replace(new.city, '^\s*[Ii][Nn]\s+', '')), '');
  end if;
  if new.city is not null then
    new.county := (
      select cl.county from county_lookup cl
      where cl.city_key = lower(btrim(new.city))
    );
  end if;
  return new;
end $function$;
