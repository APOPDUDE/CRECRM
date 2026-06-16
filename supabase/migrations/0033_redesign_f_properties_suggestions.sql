-- Redesign F: properties + suggestions

-- properties: dedupe key rename, drop redundant url, remove 'flex'
alter table public.properties rename column source_listing_id to source_key;
alter index public.properties_source_listing_uq rename to properties_source_key_uq;
alter table public.properties drop column source_url;

update public.properties set property_type = 'industrial' where property_type = 'flex';
update public.clients    set property_type = 'industrial' where property_type = 'flex';
alter type public.property_kind rename to property_kind_old;
create type public.property_kind as enum ('industrial','office','retail','land','other');
alter table public.properties alter column property_type type public.property_kind using property_type::text::public.property_kind;
alter table public.clients    alter column property_type type public.property_kind using property_type::text::public.property_kind;
-- the snapshot copies also reference the old enum; demote them to text so the type can drop
alter table backup_predesign.properties  alter column property_type type text using property_type::text;
alter table backup_predesign.tenant_reps alter column property_type type text using property_type::text;
drop type public.property_kind_old;

-- suggestions: typed client FK + status enum
alter table public.suggestions rename column tenant_rep_id to client_id;
alter index public.match_suggestions_property_id_tenant_rep_id_key rename to suggestions_property_client_uq;
alter table public.suggestions rename constraint match_suggestions_tenant_rep_id_fkey to suggestions_client_id_fkey;
alter table public.suggestions rename constraint match_suggestions_property_id_fkey   to suggestions_property_id_fkey;

alter table public.suggestions alter column status drop default;
alter table public.suggestions alter column status type public.suggestion_status using status::public.suggestion_status;
alter table public.suggestions alter column status set default 'pending';
