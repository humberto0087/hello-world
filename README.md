# San Diego Real Estate Partners: client site + deal desk

A one-stop shop for a San Diego County real estate consulting firm: **buyer representation,
loan brokerage and consulting** for new investors, experienced investors, and end users who
want to build their dream home and build equity.

Two parts, both static pages served from `docs/`:

| Page | Who it's for | What it does |
|---|---|---|
| `index.html` (client site) | The public | Service paths (start investing, build your dream home, ADUs/house hacking, fix & flip, multifamily, coastal), how-it-works steps, a **dream home calculator** (build cost, construction-to-perm loan, payment after move-in, equity created), current opportunities from the scanner, and a **client intake form** |
| `desk.html` (deal desk) | Your team | Full deal feed, loan analyzers, client CRM with goals and stages, pipeline, and an import for website leads |

The client site shows only for-sale listings and deals you add yourself. Permit leads, which name
permit holders, stay on the internal desk.

### Website inquiries
Set `intakeEndpoint` in `docs/config.js` to a form backend that accepts JSON (Formspree, Basin,
Getform…) to receive submissions directly. Without one, the form opens the visitor's email app
addressed to `email`. Either way, the message ends with a `LEAD-DATA:` line. Paste it into
**Desk → Clients → Paste website lead** to create the client record. `calendarUrl` turns the
"Book a free strategy session" button into a direct booking link.

> Note: `desk.html` is not password protected. It only shows public-record and listing data, and
> client records live only in each team member's browser. Add real authentication before putting
> any client data on a server.

## Deal scanner

A scheduled scanner keeps looking for:

| Category | What it looks for |
|---|---|
| **Fix & Flip** | Renovation/remodel permits on residential property; for-sale listings that are older and priced well below their zip's $/sf median, stale on market, or tagged fixer / as-is / probate / investor special |
| **New Construction** | New dwelling, ADU, ground-up and demo-rebuild permits; land listings; newly built homes |
| **Coastal / CCC Exemptions** | Coastal Development Permit exemptions, waivers and CDPs; deals in Coastal Zone zips |
| **Multifamily** | Apartments, 2+ unit projects, condos/townhomes, SB 9 / lot splits, density bonus, multi-family listings |

Every deal gets an opportunity score and opens a **loan analyzer** (fix & flip/bridge,
ground-up construction, DSCR/multifamily, and build-to-own construction-to-permanent), **buyer matching**, a one-click
**"email deal + loan quote"** to matching buyers, and a **pipeline** tracker.

## How it works

```
GitHub Actions (every 3h) ──> scanner/scan.js ──> docs/data/deals.json ──> docs/ (static web app on GitHub Pages)
        sources: City of San Diego permits · RentCast listings · data/manual-deals.json
```

- `scanner/sources/sdCityPermits.js` – City of San Diego Development Services approvals
  ([open data](https://data.sandiego.gov/datasets/development-permits-set2/)). Free, no key.
  Permit holders are financing leads (construction, bridge, take-out refi).
- `scanner/sources/rentcast.js` – active for-sale listings countywide via the
  [RentCast API](https://developers.rentcast.io). Needs a `RENTCAST_API_KEY` secret; skipped otherwise.
  Request volume is set in `scanner/config.json` (`everyHours`, `maxPagesPerType`) — size it to your plan.
- `scanner/sources/manual.js` – off-market deals you add to `data/manual-deals.json` (see `data/README.md`).
- `scanner/lib/merge.js` – keeps `firstSeen`, tracks price drops, marks deals off-market when they disappear, drops them after 45 days.

Clients, pipeline statuses and notes live in your browser (localStorage). Use
**Clients → Export backup** to save or move them to another device.

## Setup

1. Merge this branch into `main` (scheduled workflows only run from the default branch).
2. **Settings → Pages**: deploy from branch `main`, folder `/docs`.
3. **Settings → Actions → General → Workflow permissions**: *Read and write* (the scanner commits the feed).
4. Optional: **Settings → Secrets and variables → Actions** → add `RENTCAST_API_KEY`.
5. **Actions → Scan for deals → Run workflow** (tick *force*) for the first scan.
6. Edit `docs/config.js` with your company name, tagline, DRE/NMLS numbers, phone, email, booking link,
   form endpoint and default loan terms.

## Local use

```bash
npm test                       # scanner + loan math tests
node scanner/scan.js --force   # run all sources now (add --only=sdCityPermits to run one)
npm run serve                  # client site http://localhost:8080, desk at /desk.html
```

## Adding sources

Each source exports `run(cfg, ctx)` returning `{ deals, notes }`. Add it to `SOURCES` in
`scanner/scan.js` and to `scanner/config.json`. Good next candidates: San Diego County
(unincorporated) PDS permits, Chula Vista / Oceanside / Carlsbad permit portals,
Coastal Commission San Diego district agendas, trustee-sale/NOD feeds, ATTOM.

> Loan figures are estimates for conversations with clients, not commitments to lend.
> Permit and listing data come from third parties — verify before advising a buyer.
