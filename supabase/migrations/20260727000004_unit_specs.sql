-- Unit-level specs, so suite facts stop being written into building-level columns.
--
-- The problem: a 434,034 SF building was recorded as having 4 dock-high doors and 24'
-- clear, because those are facts about the ~45k SF suite being marketed, and the suite
-- had nowhere to store them. Building-wide truth got overwritten by suite-specific truth.
--
-- Model: a unit's spec is an OVERRIDE. Null on a unit means "same as the building", so
-- you only fill in what actually differs for that suite (e.g. 32' building-wide but 24'
-- under the mezzanine in Suite B). Resolution lives in the view below, not in the UI, so
-- every reader -- app, automation, a Claude chat on the phone -- agrees on the answer.

alter table units
  -- the office breakdown: warehouse is derived, not stored, so it can never disagree
  add column office_sf integer,
  add column dock_high_doors integer,
  add column grade_level_doors integer,
  add column dock_levelers integer,
  add column clear_height_ft numeric(5,1),
  add column three_phase_power boolean,
  add column volts text,
  add column amps integer,
  add column notes text;

alter table units
  add constraint units_office_sf_nonneg check (office_sf is null or office_sf >= 0),
  add constraint units_dock_high_nonneg check (dock_high_doors is null or dock_high_doors >= 0),
  add constraint units_grade_level_nonneg check (grade_level_doors is null or grade_level_doors >= 0),
  add constraint units_levelers_nonneg check (dock_levelers is null or dock_levelers >= 0),
  add constraint units_clear_height_nonneg check (clear_height_ft is null or clear_height_ft >= 0),
  add constraint units_amps_nonneg check (amps is null or amps >= 0),
  -- office space cannot exceed the suite it sits in
  add constraint units_office_within_size check (office_sf is null or size_sf is null or office_sf <= size_sf);

comment on column units.office_sf is
  'Office square footage inside this suite. Warehouse SF = size_sf - office_sf (see v_unit_specs).';
comment on column units.clear_height_ft is
  'Suite clear height in feet. NULL means inherit the building value.';

-- Resolved unit specs: the unit''s own value where set, otherwise the building''s, plus
-- a flag per field so the UI can show inherited values differently (greyed, "(building)").
create or replace view v_unit_specs as
select
  u.id as unit_id, u.property_id, u.label, u.size_sf, u.size_acres,
  u.asking_rate_psf, u.status, u.notes,
  u.office_sf,
  case when u.size_sf is not null and u.office_sf is not null
       then u.size_sf - u.office_sf end                        as warehouse_sf,
  coalesce(u.dock_high_doors,   p.dock_high_doors)             as dock_high_doors,
  coalesce(u.grade_level_doors, p.grade_level_doors)           as grade_level_doors,
  coalesce(u.dock_levelers,     p.dock_levelers)               as dock_levelers,
  coalesce(u.clear_height_ft,   p.clear_height_ft)             as clear_height_ft,
  coalesce(u.three_phase_power, p.three_phase_power)           as three_phase_power,
  coalesce(u.volts,             p.volts)                       as volts,
  coalesce(u.amps,              p.amps)                        as amps,
  (u.dock_high_doors   is null and p.dock_high_doors   is not null) as dock_high_doors_inherited,
  (u.grade_level_doors is null and p.grade_level_doors is not null) as grade_level_doors_inherited,
  (u.dock_levelers     is null and p.dock_levelers     is not null) as dock_levelers_inherited,
  (u.clear_height_ft   is null and p.clear_height_ft   is not null) as clear_height_ft_inherited,
  (u.three_phase_power is null and p.three_phase_power is not null) as three_phase_power_inherited,
  (u.volts             is null and p.volts             is not null) as volts_inherited,
  (u.amps              is null and p.amps              is not null) as amps_inherited
from units u
join properties p on p.id = u.property_id;

comment on view v_unit_specs is
  'Units with building specs applied as fallbacks. *_inherited flags mark which values came from the building rather than the suite.';

-- The view reads RLS-protected tables, so it must run as the caller, not the owner.
alter view v_unit_specs set (security_invoker = on);
