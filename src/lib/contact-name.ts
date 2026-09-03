import type { Contact } from '@/hooks/use-contacts'

/** "First Last" with whichever half exists. */
export function contactName(contact: Pick<Contact, 'first_name' | 'last_name'>) {
  return [contact.first_name, contact.last_name].filter(Boolean).join(' ')
}
