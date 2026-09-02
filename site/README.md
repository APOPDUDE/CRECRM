# alexpoplawski.com

Static one-page site (no build step) that turns a tenant / buyer / seller inquiry into a
Slack post in #deals and a CRM record. Lives in this repo under `site/` and deploys as its
own Vercel project.

## Files
- `index.html` - the page + the form. `thanks/index.html` - post-submit page (served at `/thanks`).
- `styles.css`, `form.js` - no frameworks, no build. Fonts: IBM Plex Sans / Mono via Google Fonts.
- `vercel.json` - clean URLs + security headers. `robots.txt`, `favicon.svg`, `og.png`, `apple-touch-icon.png`.

## Where a submission goes
`form.js` POSTs JSON to `https://n8n.ayxco.com/webhook/alexpoplawski-lead` (n8n workflow
"CRE CRM - Website lead (alexpoplawski.com)", id `mj3kCPCgScjYx91f`). Without JavaScript the same form does a native
POST and the webhook answers with a 303 to `/thanks`.

- need = lease / buy / not sure -> `intake_client` with `status = 'prospect'`, `source = 'website'`
  (a Prospect-column card on the Tenant Rep board; phone/email identity match merges onto an
  existing open client instead of duplicating).
- need = sell -> `intake_prospect` (lead_type seller; Prospecting page), property linked by address.
- Every submit -> #deals post that @mentions Alex, with CRM links. Errors DM Alex.
- Spam: honeypot field `company_website`, sub-3-second submits, and no-phone-no-email are
  accepted with `{ok:true}` and dropped. A phone that is not 10 digits gets a friendly retry message.

Field contract (form name -> meaning): `name company email phone need property_type size yard
area[] budget sell_address sell_situation timing lease_ends details found t company_website page ua`.

## Deploy (one-time, Vercel)
1. Vercel -> Add New -> Project -> import `APOPDUDE/CRECRM` again (a second project).
2. Framework preset **Other**, **Root Directory `site`**, no build command, output directory blank. Deploy.
3. Project -> Settings -> Domains -> add `alexpoplawski.com` and `www.alexpoplawski.com`
   (set www to redirect to the apex).
4. Namecheap -> Domain List -> alexpoplawski.com -> Advanced DNS -> add:
   - `A` record, host `@`, value `76.76.21.21`
   - `CNAME` record, host `www`, value `cname.vercel-dns.com`
   Remove any Namecheap parking / URL-redirect records for `@` and `www`. Vercel issues the SSL
   certificate itself once DNS resolves (usually under an hour).

Every later push to `main` that touches `site/` redeploys the site automatically.

## Local preview
`python3 -m http.server 4173 -d site` then open http://localhost:4173 (the `site` entry in
`.claude/launch.json` does the same).
