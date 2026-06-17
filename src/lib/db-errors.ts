export function friendlyDbError(error: unknown, fallback: string): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : null
  if (code === '23503') {
    return 'This record is referenced by other records and cannot be deleted'
  }
  if (code === '23514') {
    return 'The values entered violate a data rule — check the form and try again'
  }
  if (code === '23505') {
    const message =
      typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message: unknown }).message)
        : ''
    if (/phone/i.test(message)) {
      return 'A contact with this phone number already exists — search for it to edit instead'
    }
    return 'That already exists'
  }
  return fallback
}
