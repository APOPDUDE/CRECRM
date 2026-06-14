// One-off importer: emits a single SQL transaction that wipes the business tables
// and loads the 34 HubSpot deals the user selected (Tenant, User Buyer, Closed).
// Identity comes from each deal's associated HubSpot contact; the property address
// is parsed from the deal name; the full HubSpot description is preserved as the
// tenant rep's requirements + a provenance note. Run: node scripts/import-hubspot.mjs > scripts/import.sql
import { randomUUID } from 'node:crypto'

const OWNER = '33b63bc5-d42b-40b0-9ab6-7cc824450905'

// lease = tenant seeking to lease; sale = "user buyer" seeking to purchase
// executed = closed/won deal (lands at stage executed)
const DEALS = [
  // ---------- TENANT (lease) ----------
  { c:{f:'Hector',l:'Moyano',e:'hector.g.moyano@gmail.com',p:'845-430-8090'}, co:null,
    prop:{a:'13309 E US Highway 92',city:null,st:'FL',t:'industrial'}, dt:'lease', src:'cold_call', area:'Tampa / Hwy 92',
    reqs:'20-30 trucks parking, needs some office space, open parking outside. Owns his current place, looking to expand.',
    name:'Hector Moyano | 13309 E US Highway 92 | Tenant Rep | Hector owns his current place looking to expand', date:'2026-06-10' },

  { c:{f:'Justin',l:null,e:'justin@jlsremodelingservices.com',p:'941-786-7840'}, co:'JLS Remodeling Services',
    prop:null, dt:'lease', src:'email', area:'Sarasota / Manatee',
    reqs:'Remodeling business. Will do a big buildout, basically builds out with offices.',
    name:'Justin | Remodeling business | Tenant Rep |', date:'2026-05-28' },

  { c:{f:'Mike',l:null,e:null,p:'727-645-1555'}, co:null,
    prop:{a:'1121 Hamlet Ave',city:'Clearwater',st:'FL',t:'flex'}, dt:'lease', src:'cold_call', area:'Clearwater',
    reqs:'Wife runs a resale business, he does construction; running out of their garage, looking for larger space. Also a vendor / handyman.',
    name:'Mike | 1121 Hamlet Ave, Clearwater | Tenant Rep | Wife runs a resell business he does construction stuff running out of their garage right now looking for a larger space.', date:'2026-05-18' },

  { c:{f:'Stefanie',l:null,e:'swankysoireeflorida@gmail.com',p:null}, co:'Swanky Soiree Events',
    prop:null, dt:'lease', src:'email', area:'Sarasota',
    reqs:'Smartlead — need to call to understand business and requirements. Requested more info on 1401 Whitfield Ave.',
    name:'Stefanie | | Tenant Rep |', date:'2026-05-13' },

  { c:{f:'Alex',l:'Carr',e:'lvptampabay@gmail.com',p:'813-526-1652',ti:'Owner'}, co:'LVP Tampa Bay',
    prop:null, dt:'lease', src:null, area:'Clearwater / St. Pete',
    reqs:'Tenant rep assignment — Alex Carr / LVP Tampa Bay (Luxury Vinyl Plank distributor). Relocating from current warehouse, lease expires Aug 2026. Toured 2 spaces 5/1, sent 2 more options 5/6 — awaiting feedback.',
    name:'Tenant Rep | Clearwater/St. Pete | Alex Carr - Warehouse LVP', date:'2026-05-13' },

  { c:{f:'Ross',l:'Karrer',e:'shoreconstructionnj@gmail.com',p:'609-437-4580'}, co:null,
    prop:{a:'1401 Whitfield Ave',city:'Sarasota',st:'FL',t:'industrial'}, dt:'lease', src:'cold_call', area:'Sarasota',
    reqs:'Send email for sites that match, see if he likes any of them.',
    name:'Ross Karrer | 1401 Whitfield Ave | Tenant Rep |', date:'2026-05-12' },

  { c:{f:'Shanel',l:'Ramos',e:'shanel.ramos@stevenstransport.com',p:'214-647-5177',ti:'Dedicated Services Manager'}, co:'Stevens Transport',
    prop:{a:'1602 S Combee Rd',city:'Lakeland',st:'FL',t:'industrial'}, dt:'lease', src:'cold_call', area:'Lakeland',
    reqs:'Needs a yard. Re-run of failed exec. Got a call done; following up at end of week for the boss’s feedback.',
    name:'Shanel Ramos | 1602 S Combee Lakeland | Tenant Rep | Needs a yard', date:'2026-05-11' },

  { c:{f:'Werner',l:'Venter',e:'werner@cucinericci.com',p:null}, co:'Cucine Ricci - Imported Italian Kitchens',
    prop:{a:'1515 Main St',city:'Sarasota',st:'FL',zip:'34236',t:'office'}, dt:'lease', src:'email', area:'Sarasota',
    reqs:'Smart contact (Whitfield listing). Asked for additional info about 1401 Whitfield. Follow up to confirm specs, schedule a tour, or tenant rep for other sites.',
    name:'Werner Venter | 1515 Main St Sarasota FL 34236 | Tenant Rep |', date:'2026-05-07' },

  { c:{f:'Travis',l:'Alday',e:null,p:'941-380-8746'}, co:null,
    prop:{a:'1401 Whitfield Ave',city:'Sarasota',st:'FL',t:'industrial'}, dt:'lease', src:'cold_call', area:'Sarasota',
    reqs:'Just bought an underground utilities company, moving from Palmetto. Mostly parking, a little warehouse. 7 pickups, 12 trailers (~20ft avg).',
    name:'Travis Alday | 1401 Whitfield Avenue | Tenant Rep | Just bought underground utilities company', date:'2026-05-05' },

  { c:{f:'Bayne',l:'Beecher',e:'bayne@stroopdesign.com',p:null}, co:'Stroop Design & Construction Inc.',
    prop:{a:'68 Sarasota Center Blvd',city:'Sarasota',st:'FL',zip:'34240',t:'flex'}, dt:'lease', src:'email', area:'Sarasota',
    reqs:'Smarter contact — lead for Whitfield listing. Follow up.',
    name:'Bayne Beecher | 68 Sarasota Center Blvd, Sarasota, FL 34240 | Tenant Rep |', date:'2026-05-05' },

  { c:{f:'Dawn',l:null,e:'sarasotasews@gmail.com',p:null}, co:'Sarasota Sews',
    prop:{a:'2626 Bee Ridge Rd',city:'Sarasota',st:'FL',zip:'34239',t:'retail'}, dt:'lease', src:'email', area:'Sarasota',
    reqs:'Tenant rep for space — put together options and send over via email. Her current site is not industrial.',
    name:'Dawn | 2626 Bee Ridge Road Sarasota, Florida 34239 | Tenant Rep | Traditional', date:'2026-05-04' },

  { c:{f:'Debra',l:'Gamache',e:'debra@sarasotachic.com',p:null}, co:'Sarasota Chic Interiors',
    prop:{a:'7484 S Tamiami Trail',city:'Sarasota',st:'FL',t:'retail'}, dt:'lease', src:'email', area:'Sarasota',
    reqs:'Tenant for Dad’s warehouse. Follow up.',
    name:'Debra Gamache | 7484 South Tamiami Trail | Tenant Rep |', date:'2026-04-30' },

  { c:{f:'David',l:'Wesinger',e:'dwensinger@gmail.com',p:null}, co:'PM-International',
    prop:null, dt:'lease', src:'email', area:null,
    reqs:'See email chain for context.',
    name:'David Wesinger | PM International', date:'2026-04-30' },

  { c:{f:'Annabelle',l:null,e:null,p:null}, co:'Spirit Movers',
    prop:{a:'2340 Trailmate Dr',city:'Sarasota',st:'FL',t:'industrial'}, dt:'lease', src:'cold_call', area:'Sarasota',
    reqs:'Owned and operated by spiritmovers.com. In the market to lease or purchase space (moving business) if it’s a good fit. Also discussed the Whitfield listing.',
    name:'Annabelle | 2340 Trailmate Dr, Sarasota | Tenant Rep | Owner Occupied', date:'2026-04-27' },

  { c:{f:'Mikhail',l:'Sidorenko',e:'abray22@gmail.com',p:null}, co:'AthleticsFit Healthy Meal Prep Delivery',
    prop:null, dt:'lease', src:'email', area:'Tampa',
    reqs:'Smartlead — interested in the 15th St Rene site. Follow up to confirm interest and schedule a tour.',
    name:'Mikhail Sidorenko | | Landlord Rep |', date:'2026-04-27' },

  { c:{f:'Alex',l:'Fridy',e:'afridy@feedingtampabay.org',p:'813-254-1190'}, co:'Feeding Tampa Bay',
    prop:null, dt:'lease', src:'email', area:'Tampa',
    reqs:'Smartlead for 15th St property. Follow up through email or skip-trace phone number.',
    name:'Alex Fridy | Feeding Tampa Bay | Tenant Rep | Traditional', date:'2026-04-22' },

  { c:{f:'Cornelius',l:'Horton',e:'info@incrediblycln.com',p:null}, co:'Incredibly CLN',
    prop:null, dt:'lease', src:null, area:'Tampa',
    reqs:'Tenant rep assignment for the 15th campaign — see contact notes for requirements.',
    name:'Cornelius Horton - Tenant Rep', date:'2026-04-16' },

  // ---------- USER BUYER (sale / buy-side) ----------
  { c:{f:'Heather',l:'Estrada',e:null,p:null}, co:null,
    prop:{a:'4314 Hartford St',city:'Tampa',st:'FL',zip:'33619',t:'industrial'}, dt:'sale', src:'cold_call', area:'Tampa / Causeway',
    reqs:'Will only buy on the causeway for sites similar to hers, for business. Sent her the 11223 US-92 deal. Probably a unicorn buyer.',
    name:'Heather Estrada | 4314 Hartford St, Tampa, FL, 33619 | IOS | Owner Occupied', date:'2026-05-20' },

  { c:{f:'Joe',l:'Wos',e:null,p:'813-417-6585',ti:'President'}, co:'Wos Properties',
    prop:{a:'10717 E US Hwy 92',city:'Tampa',st:'FL',t:'land'}, dt:'sale', src:null, area:'Hwy 92 / East Tampa / Seffner',
    reqs:'Active IOS / industrial-assemblage buyer (with co-principal son Michael Wos, mw7102010@yahoo.com). Buy box: Hwy 92 corridor / I-4 / East Tampa / Seffner (zips 33610 + 33584 bullseye). Small lots, sub-1 acre common. Owns ~20 parcels (~47 acres). Pitch next: 11223 E US Hwy 92 (assemblage between his parcels) and 403 Crater Ln.',
    name:'Joe & Michael Wos | Buyer | 10717 E 92 Hwy, Tampa - East Tampa / Seffner | IOS / Industrial Assemblage', date:'2026-05-05' },

  { c:{f:'Gage',l:'Lechner',e:'gagewithgreen@gmail.com',p:'941-792-4879'}, co:null,
    prop:{a:'1115 30th Ave W',city:'Bradenton',st:'FL',t:'flex'}, dt:'sale', src:null, area:'Bradenton / Sarasota',
    reqs:'HVAC owner, ~$800K liquid, 841 credit. Looking to acquire 1-2 industrial/flex buildings in Bradenton/Sarasota, occupy half + lease half. Tax strategy (cost seg) + equity. Also needs to lease his current 30th Ave property once he relocates.',
    name:'Gage Lechner | HVAC Company Acquiring new Properties | 1115 30th Ave W | Commercial', date:'2026-04-13' },

  { c:{f:'George',l:null,e:null,p:null}, co:null,
    prop:{a:'2714 Industrial Park Dr',city:'Lakeland',st:'FL',t:'industrial'}, dt:'sale', src:'cold_call', area:'Lakeland',
    reqs:'Buyer of 1602 South Combee lease assignment. Interested in potentially buying the space at 1602 South Combee; sent property details. Follow up. (HubSpot contact: Jacob Levon Cullison.)',
    name:'George | 2714 Industrial Park Dr, Lakeland | Buyer of 1602 South Combee Lease Assignment |', date:'2026-04-10' },

  { c:{f:'Owen',l:null,e:null,p:null}, co:null,
    prop:null, dt:'sale', src:null, area:'Tampa',
    reqs:'Construction company owner looking to buy in Tampa. ~2,000 SF warehouse + some office, showroom, a little outdoor storage. Budget $400K-$600K to buy. Would consider leasing but only at $2,500/mo.',
    name:'Owen | Tampa | Buyer | Construction Co | Owner-User', date:'2026-04-07' },

  { c:{f:'Christopher',l:'Howell',e:null,p:null}, co:'HRC Capital 6 LLC',
    prop:{a:'2165 Sunnydale Blvd',city:'Clearwater',st:'FL',t:'flex'}, dt:'sale', src:'cold_call', area:'Clearwater',
    reqs:'Callback from Terracotta — nice small bay on Sunnydale Blvd. Talks to brokers about potential sites. He’s a buyer too; doesn’t want to sell this site right now.',
    name:'Christopher Howell | 2165 Sunnydale Blvd, Clearwater | Property | Traditional Leased', date:'2026-03-19' },

  { c:{f:'Kenneth',l:'Bevington',e:null,p:null}, co:'Princeton Tool South LLC',
    prop:{a:'9009 King Palm Dr',city:'Tampa',st:'FL',t:'industrial'}, dt:'sale', src:null, area:'Tampa',
    reqs:'Wants to purchase the parcel next to him (owned by Coca-Cola).',
    name:'Kenneth Bevington | 9009 King Palm Dr, Tampa | IOS | Owner Occupied | Buyer', date:'2026-03-16' },

  { c:{f:'Mohamed',l:'Fariad',e:'mfariad@aol.com',p:'813-997-9903'}, co:null,
    prop:{a:'8625 N Nebraska Ave',city:'Tampa',st:'FL',t:'industrial'}, dt:'sale', src:'text', area:'Tampa',
    reqs:'His boss is looking for 5-10 acres commercial, up to $5M. Only wants sites in Tampa.',
    name:'Mohamed | 8625 N Nebraska Ave, Tampa | Property | IOS Owner Occupied', date:'2026-03-16' },

  { c:{f:'Dayan',l:'Soria',e:'dayansoria69@gmail.com',p:'941-580-8522'}, co:null,
    prop:null, dt:'sale', src:null, area:'Sarasota / Manatee',
    reqs:'Paver distribution company. Wants 1 acre outdoor storage + small office (or just outdoor storage). Budget $12-$13/SF. Needs 300-400 pallet spots. Would do a 5-year lease for the perfect location. Needs to move ASAP (~20 days).',
    name:'Dayan Soria | 1 Acre Outdoor Storage | User Buyer | Paver Distribution', date:'2026-03-10' },

  { c:{f:'Angelino',l:null,e:null,p:'941-468-2834'}, co:null,
    prop:null, dt:'sale', src:null, area:'Venice',
    reqs:'Buyer looking for Venice industrial property. Less than 4,000 SF, condo or standalone.',
    name:'Angelino | Venice Industrial | Buyer | <4k sqft', date:'2026-03-09' },

  { c:{f:'Thomas',l:'Palomino',e:null,p:null}, co:null,
    prop:null, dt:'sale', src:null, area:'Sarasota',
    reqs:'Looking for 3K-10K SF on a 5-acre yard. Just sold 1607 33rd St E, Sarasota for ~$5M. Looking for more sites in the Sarasota area. Definitely contact if we have a site.',
    name:'Thomas Palomino', date:'2026-03-09' },

  { c:{f:'Pam',l:'Fitzgerald',e:'accounting@statewidesafety.net',p:null}, co:'Statewide Safety',
    prop:null, dt:'sale', src:null, area:'Plant City / Seffner',
    reqs:'Owner with husband Kevin (9204 E Broadway Ave, Tampa, FL 33619). Looking for land 1-2 acres in Plant City/Seffner for her property.',
    name:'Pam', date:'2026-03-01' },

  { c:{f:'Jorge',l:null,e:null,p:null}, co:'Hale Avenue LLC',
    prop:null, dt:'sale', src:null, area:'Tampa Airport',
    reqs:'Industrial near Tampa Airport, 22-30K SF. Chemistry business making food additives. Toured Quality Lane 3/18 — poor condition, not a fit. Needs dock-high door, min 10K SF (ideally 25K SF), fully enclosed/excellent condition (FDA requirements).',
    name:'Jorge | User Buyer | Industrial | Tampa Airport 22-30k sqft. Chemistry business making food additives', date:'2026-02-20' },

  { c:{f:'Emilio',l:'Sadez',e:null,p:null}, co:'1734 Northgate LLC',
    prop:{a:'Northgate',city:'Sarasota',st:'FL',t:'industrial'}, dt:'sale', src:'cold_call', area:'Sarasota / Naples',
    reqs:'Owns 19 properties across Sarasota and Naples; was not looking to sell but would buy. Could sell in the future; most properties occupied by his furniture wholesale company.',
    name:'Emilio | Northgate, Sarasota | Property | Furniture Wholesale Operation', date:'2025-11-19' },

  { c:{f:'Richard',l:'Moore',e:'richrpm@yahoo.com',p:null}, co:null,
    prop:{a:'8815 N 15th St',city:'Tampa',st:'FL',t:'industrial'}, dt:'sale', src:'cold_call', area:'Tampa',
    reqs:'Owner-operator said he would look to buy a building based on the per-SF price; could sell him something. Maybe.',
    name:'8815 N 15th St, Tampa FL - Richard Moore', date:'2025-10-03' },

  // ---------- CLOSED (executed) ----------
  { c:{f:'Generational',l:'Roofing'}, co:'Generational Roofing',
    prop:{a:'54 33rd Street',city:'Sarasota',st:'FL',t:'industrial'}, dt:'lease', src:'cold_call', executed:true, area:'Sarasota', closeDate:'2026-05-21',
    reqs:'SELECTED SPACE: 54 33rd Street (~5,000 SF, office + bathroom + warehouse, mezzanine, plenty of outdoor storage). Lease terms: 3-yr term, $10/SF base, 3.5% annual escalation, two 2-yr renewals at continued escalation. CAM ~$3/SF (needs verification). Rent starts once current tenant vacates. Open items: gate management, CAM confirmation.',
    name:'Generational Roofing | Leasing Assignment | Sarasota', date:'2026-03-16' },

  { c:{f:'James',l:'(Powerscreen)',e:'jamescpa@powerscreenfla.com',p:'863-604-5177',ti:'CFO'}, co:'Powerscreen FLA',
    prop:{a:'Frontage Road',city:null,st:'FL',t:'industrial'}, dt:'lease', src:'cold_call', executed:true, area:'Lakeland', closeDate:'2026-02-27',
    reqs:'Closed deal — Frontage Road / Powerscreens.',
    name:'Frontage Road | Powerscreens', date:'2025-10-07' },
]

// ---- helpers ----
const q = (v) => (v == null ? 'null' : `'${String(v).replace(/'/g, "''")}'`)
const norm = (a) => a.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

const companies = new Map() // name -> id
const properties = new Map() // normAddr -> id
const out = []

const companyId = (name) => {
  if (!name) return null
  const key = name.trim().toLowerCase()
  if (!companies.has(key)) companies.set(key, { id: randomUUID(), name })
  return companies.get(key).id
}
const propertyId = (p) => {
  if (!p) return null
  const key = norm(p.a) + '|' + (p.city || '')
  if (!properties.has(key)) properties.set(key, { id: randomUUID(), ...p })
  return properties.get(key).id
}

const contactRows = []
const tenantRepRows = []
const matchRows = []
const noteRows = []

for (const d of DEALS) {
  const coId = companyId(d.co)
  const propId = propertyId(d.prop)
  const ctId = randomUUID()
  contactRows.push({ id: ctId, coId, ...d.c })

  const trId = randomUUID()
  tenantRepRows.push({
    id: trId, coId, ctId, dt: d.dt,
    stage: d.executed ? 'executed' : 'lead',
    src: d.src, area: d.area, reqs: d.reqs,
  })

  if (propId) {
    matchRows.push({
      id: randomUUID(), propId, coId, ctId, trId,
      stage: d.executed ? 'executed' : 'inquiring',
      src: d.src, date: d.date, exec: d.executed ? d.closeDate : null,
      note: d.name,
    })
  }
  noteRows.push({ trId, body: `Imported from HubSpot deal: ${d.name}` })
}

// ---- emit SQL ----
out.push('begin;')
out.push('truncate matches, listings, tenant_reps, properties, contacts, companies, notes, files restart identity cascade;')

out.push('\n-- companies')
for (const c of companies.values())
  out.push(`insert into companies (id, name, type) values ('${c.id}', ${q(c.name)}, 'tenant');`)

out.push('\n-- properties')
for (const p of properties.values())
  out.push(`insert into properties (id, address, city, state, zip, property_type) values ('${p.id}', ${q(p.a)}, ${q(p.city)}, ${q(p.st)}, ${q(p.zip || null)}, ${p.t ? `'${p.t}'` : 'null'});`)

out.push('\n-- contacts')
for (const c of contactRows)
  out.push(`insert into contacts (id, company_id, first_name, last_name, email, phone, title) values ('${c.id}', ${c.coId ? `'${c.coId}'` : 'null'}, ${q(c.f)}, ${q(c.l || null)}, ${q(c.e || null)}, ${q(c.p || null)}, ${q(c.ti || null)});`)

out.push('\n-- tenant_reps')
for (const t of tenantRepRows)
  out.push(`insert into tenant_reps (id, owner_id, tenant_company_id, tenant_contact_id, deal_type, stage, status, source, target_area, must_haves) values ('${t.id}', '${OWNER}', ${t.coId ? `'${t.coId}'` : 'null'}, '${t.ctId}', '${t.dt}', '${t.stage}', 'active', ${t.src ? `'${t.src}'` : 'null'}, ${q(t.area)}, ${q(t.reqs)});`)

out.push('\n-- matches')
for (const m of matchRows)
  out.push(`insert into matches (id, property_id, tenant_company_id, tenant_contact_id, tenant_rep_id, stage, source, inquiry_date, execution_date, notes) values ('${m.id}', '${m.propId}', ${m.coId ? `'${m.coId}'` : 'null'}, '${m.ctId}', '${m.trId}', '${m.stage}', ${m.src ? `'${m.src}'` : 'null'}, '${m.date}', ${m.exec ? `'${m.exec}'` : 'null'}, ${q(m.note)});`)

out.push('\n-- notes')
for (const n of noteRows)
  out.push(`insert into notes (entity_type, entity_id, body) values ('tenant_rep', '${n.trId}', ${q(n.body)});`)

out.push('commit;')

console.error(`deals=${DEALS.length} companies=${companies.size} properties=${properties.size} contacts=${contactRows.length} tenant_reps=${tenantRepRows.length} matches=${matchRows.length} notes=${noteRows.length}`)
console.log(out.join('\n'))
