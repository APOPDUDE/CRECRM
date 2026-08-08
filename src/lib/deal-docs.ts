import {
  AlignmentType,
  Document,
  Packer,
  Paragraph,
  TextRun,
} from 'docx'
import { format, parseISO } from 'date-fns'
import { addMonths, subDays } from 'date-fns'
import type { Enums } from '@/lib/database.types'

/**
 * Everything a generated LOI / RFP needs, already resolved to plain values.
 * The dialog assembles this from the pursuit + client + property + listing and
 * persists the term fields back to the DB, so the document is a view of data.
 */
export interface DealDocTerms {
  docType: 'loi' | 'rfp'
  dealType: 'lease' | 'sale'
  /** yyyy-MM-dd */
  effectiveDate: string
  // Parties
  tenantName: string
  tenantContactName: string | null
  /**
   * Everyone signing on the tenant/buyer side. When set, each name gets its own
   * signature block — co-signers, second members of an LLC, guarantors. Falls
   * back to the single tenantContactName when omitted.
   */
  tenantSignatories?: string[] | null
  landlordName: string | null
  landlordContactName: string | null
  // Premises
  address: string
  cityStateZip: string | null
  additionalDescription: string | null
  proposedSf: number | null
  intendedUse: string | null
  // Lease terms
  ratePsf: number | null
  leaseStructure: Enums<'lease_structure'> | null
  opexPsf: number | null
  termMonths: number | null
  /** yyyy-MM-dd */
  commencement: string | null
  escalationPct: number | null
  freeRentMonths: number | null
  tiAllowancePsf: number | null
  securityDeposit: number | null
  renewalTerms: string | null
  specialProvisions: string | null
  // Sale terms
  proposedPrice: number | null
  earnestDeposit: number | null
  ddDays: number | null
  closingDays: number | null
  // RFP addressing
  recipient: string | null
  preparedBy: string
  /** Two-letter state code from the property (governs law + RFP wording). */
  stateCode: string | null
}

const FONT = 'Calibri'
const SIZE = 22 // 11pt (docx half-points)

const usd = (n: number, cents = true) =>
  '$' +
  n.toLocaleString('en-US', {
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  })

const psf = (n: number) => `${usd(n)} per square foot per year`
const sf = (n: number) => `${n.toLocaleString('en-US')} square feet`

const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', GA: 'Georgia', FL: 'Florida', NC: 'North Carolina', SC: 'South Carolina',
  TN: 'Tennessee', TX: 'Texas', NY: 'New York', NJ: 'New Jersey', MD: 'Maryland',
  VA: 'Virginia', PA: 'Pennsylvania', OH: 'Ohio', CA: 'California',
}
const stateName = (code: string | null) => (code ? (STATE_NAMES[code.toUpperCase()] ?? code) : 'Florida')

const longDate = (iso: string) => format(parseISO(iso), 'MMMM d, yyyy')

function termLabel(months: number): string {
  const y = Math.floor(months / 12)
  const m = months % 12
  const parts: string[] = []
  if (y > 0) parts.push(`${y} year${y === 1 ? '' : 's'}`)
  if (m > 0) parts.push(`${m} month${m === 1 ? '' : 's'}`)
  return parts.join(' and ') || `${months} months`
}

const STRUCTURE_LABELS: Record<Enums<'lease_structure'>, string> = {
  NNN: 'triple net (NNN)',
  NN: 'double net (NN)',
  MG: 'modified gross (MG)',
  FS: 'full service (FS)',
  IG: 'industrial gross (IG)',
}

function expensesClause(structure: Enums<'lease_structure'> | null, opexPsf: number | null): string {
  const est = opexPsf != null ? `, currently estimated at ${psf(opexPsf)}` : ''
  switch (structure) {
    case 'NNN':
      return `The lease shall be ${STRUCTURE_LABELS.NNN}. In addition to Base Rent, Lessee shall pay its proportionate share of real estate taxes, insurance, and common area maintenance${est}.`
    case 'NN':
      return `The lease shall be ${STRUCTURE_LABELS.NN}. In addition to Base Rent, Lessee shall pay its proportionate share of real estate taxes and insurance${est}.`
    case 'MG':
      return `The lease shall be ${STRUCTURE_LABELS.MG}${opexPsf != null ? `, with Lessee's share of operating expenses estimated at ${psf(opexPsf)}` : ''}. The parties shall define the allocation of operating expenses in the lease.`
    case 'FS':
      return `The lease shall be ${STRUCTURE_LABELS.FS}. Base Rent is inclusive of real estate taxes, insurance, maintenance, and utilities customary to a full-service lease.`
    case 'IG':
      return `The lease shall be ${STRUCTURE_LABELS.IG}${opexPsf != null ? `, with operating expenses estimated at ${psf(opexPsf)}` : ''}. The parties shall define the allocation of operating expenses in the lease.`
    default:
      return 'The allocation of operating expenses between Lessor and Lessee shall be defined in the lease.'
  }
}

// ---------------------------------------------------------------------------
// docx building blocks
// ---------------------------------------------------------------------------

const run = (text: string, opts: { bold?: boolean } = {}) =>
  new TextRun({ text, bold: opts.bold, font: FONT, size: SIZE })

const title = (text: string) =>
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 320 },
    children: [new TextRun({ text, bold: true, font: FONT, size: 28 })],
  })

/** "Label: body" paragraph, the template's section shape. */
const section = (label: string, body: string) =>
  new Paragraph({
    spacing: { after: 200 },
    children: [run(`${label}: `, { bold: true }), run(body)],
  })

const para = (text: string, opts: { bold?: boolean; after?: number } = {}) =>
  new Paragraph({
    spacing: { after: opts.after ?? 200 },
    children: [run(text, { bold: opts.bold })],
  })

const SIGN_LINE = '______________________________'

/** Tenant/buyer-side blocks: one per signatory, or a single block when none listed. */
function tenantSignatureBlocks(role: string, t: DealDocTerms): Paragraph[] {
  const names = t.tenantSignatories?.length
    ? t.tenantSignatories
    : [t.tenantContactName ?? t.tenantName]
  return names.flatMap((n) => signatureBlock(role, n))
}

function signatureBlock(role: string, name: string | null): Paragraph[] {
  return [
    para(role, { bold: true, after: 120 }),
    para(`Signature: ${SIGN_LINE}        Date: ____________________`, { after: 120 }),
    para(`Print Name: ${name ?? SIGN_LINE}`, { after: 280 }),
  ]
}

const TBD = 'to be mutually agreed'

// ---------------------------------------------------------------------------
// Lease LOI — follows Alex's template section-for-section
// ---------------------------------------------------------------------------

function leaseLoiParagraphs(t: DealDocTerms): Paragraph[] {
  const premises = [t.address, t.cityStateZip].filter(Boolean).join(', ')
  const sized = t.proposedSf != null ? `approximately ${sf(t.proposedSf)} at ${premises}` : premises

  const p: Paragraph[] = [
    title('COMMERCIAL LEASE LETTER OF INTENT'),
    section('Effective Date', longDate(t.effectiveDate)),
    para('RE: Intent to Lease Commercial Property', { bold: true }),
    section('The Lessee', `${t.tenantName} (the "Lessee")`),
    section('The Lessor', `${t.landlordName ?? SIGN_LINE} (the "Lessor")`),
    section('Address of Premises', `${sized} (the "Premises")`),
  ]

  if (t.additionalDescription) p.push(section('Additional Description', t.additionalDescription))

  // Lease term
  if (t.termMonths != null) {
    let body = `The term of the lease shall be for a period of ${termLabel(t.termMonths)}`
    if (t.commencement) {
      const start = parseISO(t.commencement)
      const end = subDays(addMonths(start, t.termMonths), 1)
      body += `, commencing on ${format(start, 'MMMM d, yyyy')} and expiring on ${format(end, 'MMMM d, yyyy')}`
    } else {
      body += `, commencing on a date ${TBD}`
    }
    p.push(section('Lease Term', body + '.'))
  } else {
    p.push(section('Lease Term', `The term of the lease shall be ${TBD}.`))
  }

  p.push(
    section(
      'Use of Leased Premises',
      t.intendedUse
        ? `The Lessee intends to use the Premises for the following purpose: ${t.intendedUse}.`
        : `The Lessee's use of the Premises shall be described in the lease.`,
    ),
  )

  // Base rent — quoted PSF/yr, computed monthly when the SF is known
  if (t.ratePsf != null) {
    const monthly =
      t.proposedSf != null ? usd((t.ratePsf * t.proposedSf) / 12) : null
    let body = `The base rent shall be ${psf(t.ratePsf)}`
    if (monthly) body += `, equating to ${monthly} per month based on approximately ${sf(t.proposedSf!)}`
    body +=
      ', paid monthly on the first of each month with the first payment due upon the commencement of the lease (the "Base Rent"), plus applicable sales tax.'
    p.push(section('Base Rent', body))
  } else {
    p.push(section('Base Rent', `The Base Rent shall be ${TBD}.`))
  }

  if (t.escalationPct != null) {
    p.push(
      section(
        'Rent Increases',
        `The Base Rent shall increase by ${t.escalationPct}% annually throughout the term.`,
      ),
    )
  }

  p.push(section('Expenses', expensesClause(t.leaseStructure, t.opexPsf)))

  if (t.freeRentMonths != null && t.freeRentMonths > 0) {
    p.push(
      section(
        'Rent Abatement',
        `Lessee shall receive ${t.freeRentMonths} month${t.freeRentMonths === 1 ? '' : 's'} of abated Base Rent following commencement.`,
      ),
    )
  }

  if (t.tiAllowancePsf != null) {
    p.push(
      section(
        'Tenant Improvements',
        `Lessor shall provide a tenant improvement allowance of ${usd(t.tiAllowancePsf)} per square foot.`,
      ),
    )
  }

  p.push(
    section(
      'Security Deposit',
      t.securityDeposit != null
        ? `A security deposit in the amount of ${usd(t.securityDeposit)} shall be due prior to or upon the signing of a lease.`
        : `The security deposit shall be ${TBD} and due prior to or upon the signing of a lease.`,
    ),
  )

  if (t.renewalTerms) p.push(section('Lease Renewal', t.renewalTerms))

  p.push(
    section(
      'Subletting',
      'The Lessee may not sublet the Premises without first obtaining the prior written consent of the Lessor.',
    ),
    section(
      'Binding Effect',
      'This Letter of Intent is non-binding. The parties acknowledge that this Letter of Intent is not enforceable by any party; the terms outlined herein are solely for the purpose of negotiating a mutually acceptable lease agreement.',
    ),
  )

  if (t.specialProvisions) p.push(section('Additional Provisions', t.specialProvisions))

  p.push(
    section(
      'Governing Law',
      `This Letter of Intent shall be governed under the laws of the State of ${stateName(t.stateCode)}.`,
    ),
    ...tenantSignatureBlocks('LESSEE', t),
    ...signatureBlock('LESSOR', t.landlordContactName ?? t.landlordName),
  )

  return p
}

// ---------------------------------------------------------------------------
// Purchase LOI — the sale-side variant (same skeleton, purchase terms)
// ---------------------------------------------------------------------------

function saleLoiParagraphs(t: DealDocTerms): Paragraph[] {
  const premises = [t.address, t.cityStateZip].filter(Boolean).join(', ')

  const p: Paragraph[] = [
    title('LETTER OF INTENT TO PURCHASE COMMERCIAL PROPERTY'),
    section('Effective Date', longDate(t.effectiveDate)),
    para('RE: Intent to Purchase Commercial Property', { bold: true }),
    section('The Buyer', `${t.tenantName} (the "Buyer")`),
    section('The Seller', `${t.landlordName ?? SIGN_LINE} (the "Seller")`),
    section('The Property', `${premises} (the "Property")`),
  ]

  if (t.additionalDescription) p.push(section('Additional Description', t.additionalDescription))

  p.push(
    section(
      'Purchase Price',
      t.proposedPrice != null
        ? `The purchase price shall be ${usd(t.proposedPrice, false)}, payable at closing.`
        : `The purchase price shall be ${TBD}.`,
    ),
    section(
      'Earnest Money Deposit',
      t.earnestDeposit != null
        ? `Buyer shall deposit ${usd(t.earnestDeposit, false)} as earnest money with a mutually acceptable escrow agent upon execution of a purchase and sale agreement.`
        : `The earnest money deposit shall be ${TBD}.`,
    ),
    section(
      'Due Diligence',
      t.ddDays != null
        ? `Buyer shall have ${t.ddDays} days from the execution of the purchase and sale agreement to inspect the Property and review title, survey, and all other matters Buyer deems relevant. Buyer may terminate within this period for any reason with a full refund of the earnest money.`
        : `Buyer shall have a due diligence period ${TBD}, during which Buyer may terminate for any reason with a full refund of the earnest money.`,
    ),
    section(
      'Closing',
      t.closingDays != null
        ? `Closing shall occur within ${t.closingDays} days after the expiration of the due diligence period.`
        : `Closing shall occur on a date ${TBD}.`,
    ),
    section(
      'Binding Effect',
      'This Letter of Intent is non-binding. The parties acknowledge that this Letter of Intent is not enforceable by any party; the terms outlined herein are solely for the purpose of negotiating a mutually acceptable purchase and sale agreement.',
    ),
  )

  if (t.specialProvisions) p.push(section('Additional Provisions', t.specialProvisions))

  p.push(
    section(
      'Governing Law',
      `This Letter of Intent shall be governed under the laws of the State of ${stateName(t.stateCode)}.`,
    ),
    ...tenantSignatureBlocks('BUYER', t),
    ...signatureBlock('SELLER', t.landlordContactName ?? t.landlordName),
  )

  return p
}

// ---------------------------------------------------------------------------
// RFP — tenant-rep side: request a proposal from the landlord / listing broker
// ---------------------------------------------------------------------------

const ask = (v: string | null) => v ?? 'Please propose.'

function rfpParagraphs(t: DealDocTerms): Paragraph[] {
  const premises = [t.address, t.cityStateZip].filter(Boolean).join(', ')

  const p: Paragraph[] = [
    title('REQUEST FOR PROPOSAL'),
    section('Date', longDate(t.effectiveDate)),
    section('To', t.recipient ?? 'Ownership / Listing Broker'),
    section('From', t.preparedBy),
    section('RE', `Request for Proposal — ${t.tenantName} — ${premises}`),
    para(
      `On behalf of ${t.tenantName} (the "Tenant"), we are pleased to submit this Request for Proposal for the premises described below. Please provide a written proposal addressing each of the following items.`,
      { after: 280 },
    ),
    section('Tenant', t.tenantName),
  ]

  if (t.intendedUse) p.push(section('Use', t.intendedUse))

  p.push(
    section(
      'Premises',
      t.proposedSf != null ? `Approximately ${sf(t.proposedSf)} at ${premises}.` : premises,
    ),
    section(
      'Lease Term',
      t.termMonths != null
        ? `${termLabel(t.termMonths)}${t.commencement ? `, commencing on or about ${longDate(t.commencement)}` : ''}.`
        : ask(null),
    ),
    section(
      'Base Rent',
      t.ratePsf != null
        ? `Tenant proposes ${psf(t.ratePsf)}${t.leaseStructure ? ` on a ${STRUCTURE_LABELS[t.leaseStructure]} basis` : ''}. Please confirm or propose, including a schedule of annual increases.`
        : `Please propose, stating the rate per square foot, the lease structure${t.leaseStructure ? ` (Tenant anticipates ${STRUCTURE_LABELS[t.leaseStructure]})` : ''}, and a schedule of annual increases.`,
    ),
    section(
      'Operating Expenses',
      t.opexPsf != null
        ? `Please provide a current operating expense estimate (currently understood to be approximately ${psf(t.opexPsf)}) and a breakdown of what is included.`
        : 'Please provide a current operating expense estimate and a breakdown of what is included.',
    ),
  )

  if (t.escalationPct != null)
    p.push(section('Rent Increases', `Tenant proposes annual increases of ${t.escalationPct}%.`))
  if (t.freeRentMonths != null && t.freeRentMonths > 0)
    p.push(
      section(
        'Rent Abatement',
        `Tenant requests ${t.freeRentMonths} month${t.freeRentMonths === 1 ? '' : 's'} of abated Base Rent following commencement.`,
      ),
    )
  if (t.tiAllowancePsf != null)
    p.push(
      section(
        'Tenant Improvements',
        `Tenant requests a tenant improvement allowance of ${usd(t.tiAllowancePsf)} per square foot.`,
      ),
    )
  if (t.renewalTerms) p.push(section('Renewal Options', t.renewalTerms))
  if (t.securityDeposit != null)
    p.push(section('Security Deposit', `Tenant proposes a security deposit of ${usd(t.securityDeposit)}.`))
  if (t.specialProvisions) p.push(section('Additional Items', t.specialProvisions))

  p.push(
    para(
      'This Request for Proposal is non-binding on both parties and is intended solely as a basis for negotiating a mutually acceptable lease agreement. We look forward to your response.',
      { after: 280 },
    ),
    para('Respectfully,', { after: 120 }),
    para(t.preparedBy, { bold: true }),
  )

  return p
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildDealDoc(t: DealDocTerms): Promise<Blob> {
  const children =
    t.docType === 'rfp'
      ? rfpParagraphs(t)
      : t.dealType === 'sale'
        ? saleLoiParagraphs(t)
        : leaseLoiParagraphs(t)

  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: SIZE } } } },
    sections: [{ children }],
  })
  return Packer.toBlob(doc)
}

/** "LOI - 123 Main St - Acme Logistics - 2026-08-07.docx" */
export function dealDocFileName(t: DealDocTerms): string {
  const kind = t.docType === 'rfp' ? 'RFP' : 'LOI'
  const clean = (s: string) => s.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim()
  return `${kind} - ${clean(t.address)} - ${clean(t.tenantName)} - ${t.effectiveDate}.docx`
}
