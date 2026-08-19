/**
 * Deep links into the GHL (LeadConnector) app. Verified contacts carry
 * `contacts.ghl_contact_id` (written back by the push workflow), which is what the
 * contact-detail URL needs — a phone number alone can't address a GHL page.
 */
const GHL_LOCATION_ID = '95lgnoZIKoEB1mbAU3xv'

export function ghlContactUrl(ghlContactId: string): string {
  return `https://app.gohighlevel.com/v2/location/${GHL_LOCATION_ID}/contacts/detail/${ghlContactId}`
}
