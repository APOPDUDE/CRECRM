/**
 * One outreach template, many different-looking texts.
 *
 * Carriers score identical bodies sent to many numbers as bulk. Two things fix that, and
 * both have to be true per recipient: the words have to differ, and the message has to
 * contain something only that person's record could produce.
 *
 * Spintax `{a|b|c}` handles the wording. Tokens like `{{property.address}}` handle the
 * substance. Both resolve from a seed derived from the recipient, so the same person
 * always gets the same text — a re-send is not a different message, and a preview is
 * honest about what will actually go out.
 */

/** Deterministic 32-bit hash → the same recipient always draws the same variant. */
function seedOf(key: string): number {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Tiny deterministic PRNG so one seed drives every choice in a message. */
function rng(seed: number): () => number {
  let s = seed || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return ((s >>> 0) % 100000) / 100000
  }
}

/**
 * Expand `{morning|afternoon}` choices. Nested braces are not supported on purpose —
 * they make a template unreadable, and unreadable outreach is how a bad line ships.
 */
export function expandSpintax(text: string, seed: number): string {
  const next = rng(seed)
  return text.replace(/\{([^{}]*\|[^{}]*)\}/g, (_m, body: string) => {
    const options = body.split('|')
    return options[Math.floor(next() * options.length)] ?? options[0]
  })
}

/** Values a template may reference, flattened to `group.field`. */
export type TokenValues = Record<string, string | null | undefined>

const TOKEN_RE = /\{\{\s*([\w.]+)\s*(?:\|\|\s*["']([^"']*)["'])?\s*\}\}/g

/** Replace `{{group.field}}`, honouring GHL's `|| "fallback"` syntax. */
export function renderTokens(text: string, values: TokenValues): string {
  return text.replace(TOKEN_RE, (_m, key: string, fallback?: string) => {
    const v = values[key]
    return (v && String(v).trim()) || fallback || ''
  })
}

/** Every token a template asks for, so the UI can flag ones we cannot fill. */
export function tokensUsed(text: string): string[] {
  return [...text.matchAll(TOKEN_RE)].map((m) => m[1])
}

/**
 * The finished text for one recipient: fill the facts, THEN spin the wording.
 *
 * Order is not a preference. A token carries its own fallback as `{{x || "y"}}`, and that
 * pipe sits inside braces — run the spinner first and it treats the fallback as a choice
 * list, emitting `Hey { "there"}`. Resolving tokens first leaves no braces for it to eat.
 */
export function renderFor(template: string, key: string, values: TokenValues): string {
  return expandSpintax(renderTokens(template, values), seedOf(key))
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

/**
 * How many genuinely different bodies a template can produce. One means every recipient
 * gets a byte-identical message, which is the pattern that gets a line flagged.
 */
export function variantCount(text: string): number {
  // Strip tokens first — their `|| "fallback"` is not a spin choice.
  const groups = text.replace(TOKEN_RE, '').match(/\{[^{}]*\|[^{}]*\}/g) ?? []
  return groups.reduce((n, g) => n * g.slice(1, -1).split('|').length, 1)
}
