-- Expand tenant rep requirements with industrial-specific fields. The generic
-- size_min_sf/size_max_sf are replaced by three space-type breakdowns
-- (warehouse SF, office SF, outdoor storage acreage), each with min/max.

alter table tenant_reps
  add column move_in_date date,
  add column move_in_context text,
  add column power_requirements text,
  add column outdoor_storage_min_ac numeric(10,2),
  add column outdoor_storage_max_ac numeric(10,2),
  add column warehouse_sf_min integer,
  add column warehouse_sf_max integer,
  add column office_sf_min integer,
  add column office_sf_max integer,
  add column loading_type text,
  add column clear_height text,
  add column business_industry text,
  add column business_website text;

-- preserve existing generic size as warehouse SF before dropping the old columns
update tenant_reps set warehouse_sf_min = size_min_sf, warehouse_sf_max = size_max_sf;

alter table tenant_reps
  drop column size_min_sf,
  drop column size_max_sf;
