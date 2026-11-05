#!/usr/bin/env node
// Runs every enabled source, merges results into docs/data/deals.json.
// Usage: node scanner/scan.js [--force] [--only=sourceName]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeDeals } from './lib/merge.js';
import { CATEGORIES } from './lib/classify.js';
import * as sdCityPermits from './sources/sdCityPermits.js';
import * as rentcast from './sources/rentcast.js';
import * as manual from './sources/manual.js';

const SOURCES = { sdCityPermits, rentcast, manual };
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; }
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const only = args.find((a) => a.startsWith('--only='))?.split('=')[1];

  const config = JSON.parse(await readFile(resolve(ROOT, 'scanner/config.json'), 'utf8'));
  const outPath = resolve(ROOT, config.output);
  const statePath = resolve(ROOT, config.statePath);
  const prevFeed = await readJson(outPath, { deals: [] });
  const state = await readJson(statePath, { sources: {} });
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  const ctx = {
    fetch: (url, opts = {}) => fetch(url, { ...opts, headers: { 'User-Agent': 'sd-deal-finder/1.0', ...(opts.headers || {}) } }),
    env: process.env,
    now,
    coastalZips: config.coastalZips,
    paths: { manualDeals: resolve(ROOT, config.manualDeals) },
  };

  const fresh = [];
  const ranSources = new Set();
  const report = [];

  for (const [name, cfg] of Object.entries(config.sources)) {
    if (!cfg.enabled || !SOURCES[name]) continue;
    if (only && only !== name) continue;
    const st = (state.sources[name] ||= {});
    const hoursSince = st.lastSuccess ? (now - new Date(st.lastSuccess).getTime()) / 3_600_000 : Infinity;
    if (!force && cfg.everyHours && hoursSince < cfg.everyHours) {
      report.push(`- ${name}: not due (ran ${hoursSince.toFixed(1)}h ago, every ${cfg.everyHours}h) — keeping previous results`);
      continue;
    }
    try {
      const t0 = Date.now();
      const r = await SOURCES[name].run(cfg, ctx);
      if (r.skipped) { report.push(`- ${name}: ${r.notes.join('; ')}`); continue; }
      fresh.push(...r.deals);
      ranSources.add(name);
      Object.assign(st, { lastSuccess: nowIso, lastCount: r.deals.length, lastError: null, notes: r.notes });
      report.push(`- ${name}: ${r.deals.length} deals in ${((Date.now() - t0) / 1000).toFixed(1)}s (${r.notes.join(' | ')})`);
    } catch (e) {
      st.lastError = `${nowIso}: ${e.message}`;
      report.push(`- ${name}: ERROR ${e.message} — keeping previous results`);
    }
  }

  // De-duplicate across sources by id.
  const byId = new Map();
  for (const d of fresh) byId.set(d.id, d);

  const deals = mergeDeals(prevFeed.deals, [...byId.values()], {
    ranSources,
    nowIso,
    dropAfterDaysUnseen: config.dropAfterDaysUnseen,
  });

  const counts = Object.fromEntries(Object.keys(CATEGORIES).map((k) => [k, deals.filter((d) => d.active && d.categories.includes(k)).length]));
  const feed = {
    generatedAt: nowIso,
    region: 'San Diego County, CA',
    categories: CATEGORIES,
    counts,
    sources: Object.fromEntries(Object.entries(config.sources).map(([k, v]) => [k, { label: v.label, enabled: v.enabled, ...state.sources[k] }])),
    deals,
  };

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(feed, null, 1) + '\n');
  await writeFile(statePath, JSON.stringify(state, null, 2) + '\n');

  console.log(`Scan ${nowIso}`);
  console.log(report.join('\n'));
  console.log(`Total: ${deals.length} deals (${deals.filter((d) => d.isNew).length} new). By category: ${JSON.stringify(counts)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
