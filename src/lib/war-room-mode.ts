/**
 * What the War Room is looking at (Alex 2026-09-05): plain properties, the leases in
 * them, or the Market Monitor's signals on them. The rail keeps every filter in every
 * mode; a mode only adds its own questions at the top. Lives outside the component
 * files so Fast Refresh keeps working (a component file may export only components).
 */
export type WarRoomMode = 'properties' | 'leases' | 'signals'

export const WAR_ROOM_MODES: { v: WarRoomMode; label: string }[] = [
  { v: 'properties', label: 'Properties' },
  { v: 'leases', label: 'Leases' },
  { v: 'signals', label: 'Signals' },
]
