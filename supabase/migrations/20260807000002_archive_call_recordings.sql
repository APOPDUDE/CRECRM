-- Call recordings become ours instead of a link that dies.
--
-- Terrakotta hands out presigned S3 URLs with X-Amz-Expires=604800 -- seven days and the
-- link 404s. Those URLs currently live inside communications.body as text, so today's
-- conversation log is a set of ticking links. This copies the audio into our own Storage
-- and points the row at that copy.
--
-- Deliberately a SEPARATE bucket from deal-files: that one is mirrored to Alex's Finder
-- folder by rclone bisync, and a few hundred MP3s appearing under a tree the reconciler
-- doesn't recognise is exactly the shape of the 2026-08-04 "too many deletes" outage.
-- Recordings are app-internal, so they stay out of that mirror entirely.

insert into storage.buckets (id, name, public)
values ('call-recordings', 'call-recordings', false)
on conflict (id) do nothing;

-- Same posture as deal-files: private, any authenticated user of this single-user app.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'call_recordings_auth_read'
  ) then
    create policy "call_recordings_auth_read" on storage.objects
      for select to authenticated using (bucket_id = 'call-recordings');
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'call_recordings_auth_write'
  ) then
    create policy "call_recordings_auth_write" on storage.objects
      for insert to authenticated with check (bucket_id = 'call-recordings');
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'call_recordings_auth_delete'
  ) then
    create policy "call_recordings_auth_delete" on storage.objects
      for delete to authenticated using (bucket_id = 'call-recordings');
  end if;
end $$;

alter table communications
  -- storage key inside call-recordings; null = not archived (yet, or nothing to archive)
  add column if not exists recording_path text,
  add column if not exists recording_bytes bigint,
  add column if not exists recording_synced_at timestamptz,
  -- last failure reason, so a dead link is visible instead of silently never appearing
  add column if not exists recording_error text;

comment on column communications.recording_path is
  'Key in the private call-recordings bucket. The durable copy of a recording whose source URL expires.';

/**
 * Rows that still need archiving: a recording URL we can see, no local copy yet.
 *
 * The URL lives in body as free text (that is how the GHL note arrives), so it is dug out
 * with a regex rather than a column. It must match actual AUDIO -- taking the first URL in
 * the body instead pulls Teams links, LoopNet listings, Calendly invites and Google Maps
 * directions out of imported HubSpot notes, and we would archive HTML as "recordings"
 * (2,419 rows matched a naive URL regex; 5 were really recordings).
 *
 * TIMING, measured the hard way: a Terrakotta presigned URL advertises
 * X-Amz-Expires=604800 (7 days) but also carries an X-Amz-Security-Token, and the link
 * dies with whichever expires first -- the STS session, roughly an hour. A link written
 * at 14:09 was already returning "ExpiredToken" by 19:48. So archiving has to happen
 * within minutes of the note appearing, which is why the tag-sync workflow calls the
 * archiver inline; the 15-minute sweep is only a safety net.
 *
 * Once S3 answers ExpiredToken the audio is gone for good. Those rows drop out of the
 * queue (retrying achieves nothing and would post a Slack warning every 15 minutes
 * forever) but keep recording_error set, so the UI can say "recording expired" rather
 * than silently showing nothing.
 *
 * Ordered oldest-first: the oldest link is the nearest to expiry, so a partial sweep
 * should save the ones about to die.
 */
create or replace view v_recordings_to_archive as
with candidate as (
  select
    c.id,
    c.occurred_at,
    c.phone,
    c.recording_error,
    coalesce(
      c.raw ->> 'recording_url',
      (select m[1]
         from regexp_matches(c.body, '(https?://[^\s<>]*\.(?:mp3|wav|m4a)[^\s<>]*)', 'g') m
        limit 1)
    ) as source_url
  from communications c
  where c.recording_path is null
)
select id, occurred_at, phone, source_url
from candidate
where source_url is not null
  and (recording_error is null
       or recording_error not like '%ExpiredToken%'
       and recording_error not like '%expired or forbidden%')
order by occurred_at asc;

grant select on v_recordings_to_archive to authenticated;
