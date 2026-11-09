# CLAUDE.md

San Diego County real estate deal finder (package name `sd-deal-finder`). Two parts:

1. **Scanner** (`scanner/`, Node): pulls deals from sources and writes `docs/data/deals.json`.
   GitHub Actions runs it every 3 hours.
2. **Static web app** (`docs/`, served by GitHub Pages from `master` → `/docs`):
   - `index.html` + `js/site.js`: the public client site (services, dream home calculator, intake form).
   - `desk.html` + `js/app.js`: the internal deal desk (deal feed, loan analyzers, client CRM, pipeline).
   - `js/finance.js`: loan math that both pages share. It is also unit-tested from `scanner/test/`.
   - `config.js`: branding, contact info and default loan terms (`window.DEAL_DESK_CONFIG`).

`README.md` is the user-facing guide. Keep it in sync when behavior or setup changes.

## Commands

```bash
npm test                                    # all tests (node:test): scanner + loan math
node --test scanner/test/finance.test.js    # one test file
node scanner/scan.js --force                # run every source now, ignoring everyHours throttles
node scanner/scan.js --force --only=manual  # run a single source (sdCityPermits | rentcast | manual)
npm run serve                               # http://localhost:8080 (client site), /desk.html (desk)
```

- Node >= 20 (CI uses 22). There are **no dependencies**: no `npm install` step, no build, no bundler, no linter.
- `rentcast` is skipped unless `RENTCAST_API_KEY` is set. `sdCityPermits` downloads a large CSV
  (about 550k rows) from data.sandiego.gov. Avoid live scans unless the task needs one; tests use fixtures.
- Always run `npm test` before committing. CI runs it before every scan.

## Code style

- ES modules everywhere (`"type": "module"`), using `node:` built-ins only (`node:fs/promises`, `node:test`, `node:assert/strict`).
- 2-space indent, single quotes, semicolons, trailing commas in multiline literals, `const` and arrow functions.
  Use modern syntax freely (`?.`, `??`, `||=`, numeric separators).
- Browser code is plain ES modules loaded via `<script type="module">`: no framework and no build step.
  `config.js` is a classic script that sets `window.DEAL_DESK_CONFIG`. Escape any data you interpolate into HTML (see `esc()` in `site.js`).
- Short header comment at the top of each module explaining what it does. Comment only the non-obvious parts.
- Percentages in finance code and config are **whole numbers** (`10` = 10%).
- Tests use `node:test` + `node:assert/strict`, with fixed time (`NOW`) and CSV fixtures in `scanner/test/fixtures/`.
  Add or adjust a test with every change to classification, merge or finance logic.

## Architecture notes

- **Sources** (`scanner/sources/*.js`) export `run(cfg, ctx)` → `{ deals, notes }` (or `{ skipped: true, notes }`).
  To add one, register it in `SOURCES` in `scanner/scan.js` and give it an entry in `scanner/config.json`
  (`enabled`, `label`, optional `everyHours`). `ctx` provides `fetch`, `env`, `now`, `coastalZips` and `paths`.
- Export the pure transform functions (e.g. `permitRowToDeal`, `listingsToDeals`) so tests can call them without the network.
- `scanner/lib/classify.js`: keyword classification into categories `fix_flip`, `new_construction`, `coastal` and
  `multifamily`, plus `scoreDeal`. Coastal zips are listed in `scanner/config.json`.
- `scanner/lib/merge.js`: keeps `firstSeen`, tracks price drops, marks deals off-market when unseen and drops them after 45 days.
- `docs/data/scan-state.json` stores per-source `lastSuccess` for throttling.
- Off-market deals added by hand go in `data/manual-deals.json` (format: `data/README.md`).

## Things to know

- **Default branch is `master`.** Scheduled workflows only run there.
- **Don't hand-edit `docs/data/deals.json` or `docs/data/scan-state.json`.** The `deal-scanner[bot]` regenerates and commits them
  every few hours ("Update deal feed …" commits). Leave them out of feature commits. If they conflict, take the remote version.
- Pushes to `master` that touch `scanner/**` or `data/manual-deals.json` trigger a scan.
- **Privacy:** the public client site shows only for-sale listings and manual deals. Permit leads, which name
  permit holders, must stay on the internal desk. Client and CRM data live only in the browser's localStorage
  (keys prefixed `dd:`). Never send them to a server or commit them.
- `desk.html` has no authentication. Don't add features that put client data on a server without adding auth first.
- California advertising requires `licenseLine` (DRE/NMLS) to appear on the client site.
- Loan figures are estimates, not commitments. Keep that disclaimer wherever loan numbers appear.
- `hello.html` at the repo root is a leftover from the initial commit and isn't part of the app.
