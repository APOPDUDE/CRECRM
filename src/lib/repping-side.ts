export type ReppingSide = 'landlord' | 'tenant'

const KEY = 'repping-side'

/** The repping side the user was last looking at, so returning to /repping restores it. */
export function getReppingSide(): ReppingSide {
  try {
    return localStorage.getItem(KEY) === 'tenant' ? 'tenant' : 'landlord'
  } catch {
    return 'landlord'
  }
}

export function setReppingSide(side: ReppingSide): void {
  try {
    localStorage.setItem(KEY, side)
  } catch {
    /* ignore */
  }
}
