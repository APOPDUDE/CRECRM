-- Redesign: add 'vendor' to company_type (kept separate; enum value adds
-- run cleanest on their own).
alter type public.company_type add value if not exists 'vendor';
