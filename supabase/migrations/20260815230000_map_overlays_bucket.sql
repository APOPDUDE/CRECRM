-- War Room overlays (plan-war-room-overhaul Phase 1): a PUBLIC bucket for the
-- prebuilt overlay GeoJSON (zoning districts, lowlands). Public on purpose —
-- these are county-published shapes, not deal data, and the map fetches them
-- without a session-refresh dance. deal-files stays private and untouched.
--
-- Objects are versioned filenames (overlay_zoning.v1.geojson …) uploaded with
-- long Cache-Control via the Storage API — NEVER by SQL against storage.objects
-- (Supabase storage is API-managed; SQL writes corrupt its bookkeeping).
insert into storage.buckets (id, name, public)
values ('map-overlays', 'map-overlays', true)
on conflict (id) do update set public = true;

-- Public read (the bucket flag covers /object/public/, this covers REST/list too).
create policy "map_overlays_public_read" on storage.objects
  for select using (bucket_id = 'map-overlays');

-- Only authenticated sessions may write; refreshes upload a NEW versioned name,
-- so update/delete stay useful for cleanup only.
create policy "map_overlays_auth_write" on storage.objects
  for insert to authenticated with check (bucket_id = 'map-overlays');
create policy "map_overlays_auth_update" on storage.objects
  for update to authenticated using (bucket_id = 'map-overlays');
create policy "map_overlays_auth_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'map-overlays');
