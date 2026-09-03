import type { LayerFeatureProps } from '@/hooks/use-map-layers'

/**
 * Plain-English definitions for the codes the map layers carry — what a click on a
 * feature explains under its facts (Alex 2026-09-03: "minor industry lead — what does
 * that even mean?"). Rail statuses are the FRA network's NET codes; flood zones are
 * FEMA's; wetland codes are the USFWS Cowardin classification.
 */

const RAIL_STATUS: Record<string, string> = {
  'Main line':
    'The through route: the railroad\'s primary track between yards, terminals and cities. Scheduled freight runs here (and Amtrak where flagged). Expect regular trains, higher speeds and the strictest crossing rules.',
  'Industrial lead':
    'A branch off the main line built to serve an industrial area. Trains go in only to drop off and pick up cars for the businesses on it — switching moves, not through traffic. A parcel on one can get rail service by agreement with the owning railroad.',
  'Minor industrial lead':
    'A short spur serving one or a few customers, switched on demand at low speed. No through trains. Service is possible by a spur or siding agreement with the owner; the lead may see only a few moves a week.',
  'Passing siding':
    'A parallel track over 4,000 ft where one train waits for another to pass. Operations only — it does not serve customers.',
  'Yard track':
    'Track inside a rail yard where cars are sorted and stored.',
  'Rail ferry':
    'A car-ferry link in the rail network.',
  'Out of service':
    'Track still in the ground but not operated. It can be reactivated by the railroad; check with the owner before counting on it either way.',
  Abandoned:
    'The railroad received federal (STB) authority to abandon the line; no service. The corridor may have been sold to adjoining owners, railbanked, or left in place.',
  'Abandoned (track removed)':
    'Abandoned and the rails have been pulled. The right-of-way strip may still exist as a separate parcel or easement.',
  Trail:
    'A former railroad right-of-way now used as a trail (usually railbanked, which preserves the option to restore rail).',
  'Transit / tourist':
    'A transit line or a museum / tourist operation — not freight.',
}

const RAIL_TERMS =
  'Owner is the railroad that holds the track; "rights" lists another railroad allowed to run trains over it (trackage rights). Subdivision is the railroad\'s name for the operating segment. Tracks is the number of tracks on the segment.'

const CROSSING_TERMS =
  'Trains per day is what the railroad reported to the FRA on its crossing inventory form (day / night split), updated when the railroad files — it is the only public stand-in for a freight schedule; freight railroads publish no timetables. Max speed is the railroad\'s authorized timetable speed at this point. At grade = the road crosses the rails at the same level; RR over / under = a bridge. Public = a public road crossing; Private = a driveway or private road. The warning device is what protects the crossing (gates, flashing lights, crossbucks, or none); a whistle ban means a quiet zone where trains do not sound the horn routinely.'

const FLOOD_ZONES: Record<string, string> = {
  A: '1% annual chance flood (the "100-year" flood) with no base flood elevation determined — an approximate study. Flood insurance is mandatory for federally backed mortgages.',
  AE: '1% annual chance flood with base flood elevations (BFE) determined. Finished floors are set at or above the BFE (usually plus freeboard). Flood insurance is mandatory for federally backed mortgages.',
  AH: '1% annual chance shallow flooding (ponding), typically 1–3 ft deep, with BFEs determined.',
  AO: '1% annual chance shallow sheet flow on sloping ground, typically 1–3 ft deep.',
  A99: '1% annual chance area protected by a federal flood control system under construction.',
  AR: 'A temporarily increased flood risk while a flood control system is restored.',
  VE: 'Coastal high hazard: 1% annual chance flooding with storm-wave action (3 ft+ waves). The strictest construction rules — elevated on pilings, no fill, no enclosed space below the BFE.',
  V: 'Coastal high hazard with wave action, no BFE determined.',
  X: 'Shaded X: the 0.2% annual chance (500-year) floodplain, or shallow 1% flooding under a foot deep. Moderate risk; insurance is not mandatory.',
}

const FLOOD_SUB: Record<string, string> = {
  floodway:
    'Regulatory floodway: the channel plus the land that must stay open to carry the 1% flood. Fill and structures are generally prohibited unless a study proves no rise.',
  coastal:
    'Inside FEMA\'s coastal floodplain — check for a Limit of Moderate Wave Action (LiMWA) line, which brings Zone V–style construction rules into part of the AE zone.',
  levee: 'Reduced risk because of a levee; the levee must stay accredited for that to hold.',
}

const BFE_TERM = 'BFE is the water surface elevation of the 1% flood in feet (NAVD88); the lowest floor must be at or above it.'

// USFWS Cowardin codes, e.g. PFO3C: system P, class FO, subclass 3, water regime C
const NWI_SYSTEM: Record<string, string> = {
  P: 'Palustrine — freshwater, non-tidal wetland (marsh, swamp, pond)',
  L: 'Lacustrine — lake',
  R: 'Riverine — river or stream',
  E: 'Estuarine — tidal, brackish (bay, mangrove, salt marsh)',
  M: 'Marine — open coast',
}
const NWI_CLASS: Record<string, string> = {
  FO: 'forested (trees over 20 ft)',
  SS: 'scrub-shrub (woody plants under 20 ft)',
  EM: 'emergent (marsh — grasses, sedges, cattails)',
  AB: 'aquatic bed (submerged or floating plants)',
  UB: 'open water (unconsolidated bottom — pond or lake bed)',
  US: 'unconsolidated shore (beach, bar, flat)',
  RB: 'rock bottom',
  RS: 'rocky shore',
  ML: 'moss-lichen',
  SB: 'streambed',
  OW: 'open water',
}
const NWI_SUBCLASS: Record<string, string> = {
  FO1: 'broad-leaved deciduous',
  FO2: 'needle-leaved deciduous (cypress)',
  FO3: 'broad-leaved evergreen',
  FO4: 'needle-leaved evergreen (pine)',
  FO5: 'dead trees',
  FO6: 'deciduous',
  FO7: 'evergreen',
  SS1: 'broad-leaved deciduous',
  SS2: 'needle-leaved deciduous',
  SS3: 'broad-leaved evergreen',
  SS4: 'needle-leaved evergreen',
  SS5: 'dead shrubs',
  SS6: 'deciduous',
  SS7: 'evergreen',
  EM1: 'persistent (stays standing through the dry season)',
  EM2: 'non-persistent',
  EM5: 'phragmites',
}
const NWI_REGIME: Record<string, string> = {
  A: 'temporarily flooded — brief surface water in the growing season',
  B: 'saturated — soil wet to the surface most of the season, seldom flooded',
  C: 'seasonally flooded — surface water for extended periods, usually gone by late season',
  D: 'seasonally saturated',
  E: 'seasonally flooded / saturated',
  F: 'semipermanently flooded — surface water most of the year',
  G: 'intermittently exposed — water nearly all year',
  H: 'permanently flooded',
  J: 'intermittently flooded',
  K: 'artificially flooded',
  L: 'subtidal — always submerged (tidal)',
  M: 'irregularly exposed (tidal)',
  N: 'regularly flooded by tides',
  P: 'irregularly flooded by tides',
  R: 'seasonally flooded, tidal',
  S: 'temporarily flooded, tidal',
  T: 'semipermanently flooded, tidal',
  V: 'permanently flooded, tidal',
}
const NWI_MODIFIER: Record<string, string> = {
  b: 'beaver',
  d: 'partially drained / ditched',
  f: 'farmed',
  h: 'diked / impounded',
  r: 'artificial substrate',
  s: 'spoil',
  x: 'excavated (dug — borrow pit, stormwater pond, canal)',
}

/** "PFO3C" -> the pieces in words. Unknown pieces are left out rather than guessed. */
export function decodeNwiCode(code: string): string[] {
  const m = /^([PLREM])(\d)?([A-Z]{2})?(\d)?([A-Z])?([a-z]+)?$/.exec(code.trim())
  if (!m) return []
  const [, sys, , cls, sub, regime, mods] = m
  const out: string[] = []
  if (NWI_SYSTEM[sys]) out.push(NWI_SYSTEM[sys])
  if (cls && NWI_CLASS[cls]) {
    const subLabel = sub ? NWI_SUBCLASS[`${cls}${sub}`] : undefined
    out.push(subLabel ? `${NWI_CLASS[cls]}, ${subLabel}` : NWI_CLASS[cls])
  }
  if (regime && NWI_REGIME[regime]) out.push(NWI_REGIME[regime])
  if (mods) {
    for (const ch of mods) if (NWI_MODIFIER[ch]) out.push(NWI_MODIFIER[ch])
  }
  return out
}

const NWI_CAVEAT =
  'NWI is a photo-interpreted screening map (USFWS). The regulatory wetland line comes from a jurisdictional determination by the Army Corps or the water management district after a field delineation — it can be larger or smaller than what is drawn here.'

/** Paragraphs to show under a feature's facts. Empty when there is nothing worth saying. */
export function layerDefinitions(p: LayerFeatureProps): string[] {
  switch (p.k) {
    case 'rail_line': {
      const out: string[] = []
      if (p.st && RAIL_STATUS[p.st]) out.push(`${p.st}: ${RAIL_STATUS[p.st]}`)
      if (p.pass) out.push(`Passenger service: ${p.pass}. Through Tampa that is Amtrak's Silver Star (two trains a day); the freight owner still controls the track.`)
      out.push(RAIL_TERMS)
      return out
    }
    case 'rail_crossing':
      return [CROSSING_TERMS]
    case 'flood_zone': {
      const out: string[] = []
      if (p.sub === '0.2%') out.push(FLOOD_ZONES.X)
      else if (p.zone && FLOOD_ZONES[p.zone]) out.push(`Zone ${p.zone}: ${FLOOD_ZONES[p.zone]}`)
      else if (p.zone?.startsWith('V')) out.push(FLOOD_ZONES.V)
      if (p.sub && FLOOD_SUB[p.sub]) out.push(FLOOD_SUB[p.sub])
      if (p.bfe != null) out.push(BFE_TERM)
      return out
    }
    case 'wetland': {
      const out: string[] = []
      if (p.code) {
        const parts = decodeNwiCode(p.code)
        if (parts.length) out.push(`${p.code}: ${parts.join(' · ')}.`)
      }
      out.push(NWI_CAVEAT)
      return out
    }
    case 'electric_transmission':
      return ['High-voltage transmission (HIFLD). Capacity for a large load is taken at a substation, not from the line itself; the serving utility issues a will-serve letter.']
    case 'electric_substation':
      return ['Where transmission voltage steps down for distribution. Distance to an in-service substation is the best public proxy for how much power can reach a site; the utility confirms capacity.']
    case 'gas_transmission':
      return ['Interstate / intrastate transmission pipeline (EIA). Local distribution mains are not published; a tap needs the operator.']
    case 'water_main':
    case 'sewer_gravity':
    case 'sewer_force':
      return [
        p.k === 'sewer_force'
          ? 'A force main is pressurized sewer pumped from a lift station; a parcel cannot tie into it by gravity — a connection needs its own pump or a gravity main nearby.'
          : p.k === 'sewer_gravity'
            ? 'A gravity sewer main flows by slope; a parcel above it can usually connect without a pump — the cheapest sewer service to build to.'
            : 'A potable water main. Diameter and material are the utility\'s own asset record; capacity for a large user is confirmed by the utility.',
      ]
    case 'easement':
      return p.sub === 'row'
        ? ['Public right-of-way: land the public holds for a road; not an encumbrance on the parcel itself.']
        : p.sub === 'vacated'
          ? ['A vacated or released instrument: recorded as no longer in effect. Shown for history.']
          : ['A recorded easement: someone else holds a right to use this strip (utility, drainage, access…). It stays with the land and limits what can be built on it. The reference is the recorded instrument (OR = official records book/page, PB = plat book).']
    default:
      return []
  }
}
