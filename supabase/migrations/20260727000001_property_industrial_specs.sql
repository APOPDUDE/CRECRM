-- Industrial specs on properties: the things that actually decide whether a warehouse
-- works for a tenant -- loading, clear height, power, and how much of the land is usable.
-- These replace the display slots freed up by dropping parking ratio / FAR / stories /
-- construction status from the property page (those columns stay, they are just not shown).

alter table properties
  -- acreage you can actually build on / use, vs the gross parcel in land_acres
  add column usable_acres numeric(10,2),
  -- loading doors, counted
  add column dock_high_doors integer,
  add column grade_level_doors integer,
  -- feet, stored as a number so it can be matched against a tenant requirement later.
  -- A listing quoting a range ("27-35") is entered as its minimum.
  add column clear_height_ft numeric(5,1),
  -- three-phase power present; null = unknown, not "no"
  add column three_phase_power boolean,
  -- free text: real listings quote a range ("277-480"), not a single figure
  add column volts text;

alter table properties
  add constraint properties_usable_acres_nonneg check (usable_acres is null or usable_acres >= 0),
  add constraint properties_dock_high_doors_nonneg check (dock_high_doors is null or dock_high_doors >= 0),
  add constraint properties_grade_level_doors_nonneg check (grade_level_doors is null or grade_level_doors >= 0),
  add constraint properties_clear_height_nonneg check (clear_height_ft is null or clear_height_ft >= 0),
  -- usable acreage cannot exceed the parcel it sits on
  add constraint properties_usable_acres_within_land
    check (usable_acres is null or land_acres is null or usable_acres <= land_acres);

comment on column properties.usable_acres is 'Usable/buildable acreage; <= land_acres.';
comment on column properties.clear_height_ft is 'Clear height in feet; for a quoted range, the minimum.';
comment on column properties.volts is 'Service voltage as quoted, e.g. "277-480".';
