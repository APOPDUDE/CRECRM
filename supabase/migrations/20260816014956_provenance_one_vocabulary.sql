-- Audit item 3 (provenance): one vocabulary, enforced. 'import' meant nothing (the only importer
-- was CoStar) -> 'costar'; 'leasecomp_import' folds into 'lease_comp'; contacts.source_system
-- becomes contacts.source (zero app readers, three DB functions patched in place). CHECKs pin the
-- registry so an eighth spelling cannot creep in. lead_source (marketing attribution) is a
-- different question and stays separate.

update comps set source = 'costar' where source = 'import';
update properties set source = 'lease_comp' where source = 'leasecomp_import';

alter table comps add constraint comps_source_vocab
  check (source is null or source in ('scrape','costar','manual','broker','county_appraiser'));
alter table properties add constraint properties_source_vocab
  check (source is null or source in ('manual','scrape','cold_call','owner_import','county_appraiser','lease_comp'));
alter table companies add constraint companies_source_vocab
  check (source is null or source in ('lease_comp','email_campaign','county_appraiser','costar','manual'));

alter table contacts rename column source_system to source;

do $patch$
declare fn text; src text; n int := 0;
begin
  foreach fn in array array['import_terrakotta_batch','import_hubspot_batch','ghl_verify_owner'] loop
    src := pg_get_functiondef((fn || '(jsonb)')::regprocedure);
    if position('source_system' in src) = 0 then
      raise exception '% no longer references source_system - patch list stale', fn;
    end if;
    execute replace(src, 'source_system', 'source');
    n := n + 1;
  end loop;
  if exists (select 1 from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
             join pg_language l on l.oid=p.prolang
             where ns.nspname='public' and l.lanname in ('sql','plpgsql')
               and p.prosrc like '%source_system%') then
    raise exception 'a live function still references source_system after patching';
  end if;
end
$patch$;

do $patch2$
declare src text;
begin
  src := pg_get_functiondef('import_lease_comps(jsonb)'::regprocedure);
  if position('''import''' in src) > 0 then
    execute replace(src, '''import''', '''costar''');
  end if;
end
$patch2$;

alter table contacts add constraint contacts_source_vocab
  check (source is null or source in ('hubspot','terrakotta','smartlead','email_campaign','ghl','manual','costar','county_appraiser'));
