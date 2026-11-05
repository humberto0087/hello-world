// Deals you add by hand (off-market tips, wholesaler emails, Coastal Commission
// agenda items, etc.). Edit data/manual-deals.json — see data/README.md.

import { readFile } from 'node:fs/promises';
import { classifyText, isCoastalZip } from '../lib/classify.js';

export function manualToDeals(items, coastalZips) {
  return items.map((m, i) => {
    const c = classifyText([m.title, m.description].filter(Boolean).join('. '));
    const cats = new Set([...(m.categories || []), ...c.categories]);
    if (isCoastalZip(m.zip, coastalZips)) cats.add('coastal');
    return {
      kind: 'listing',
      sourceLabel: 'Manual / off-market',
      ...m,
      id: `manual:${m.id || i}`,
      source: 'manual',
      categories: [...cats],
      coastalExemption: m.coastalExemption ?? c.coastalExemption,
      units: m.units ?? c.units,
    };
  });
}

export async function run(cfg, ctx) {
  let items = [];
  try {
    items = JSON.parse(await readFile(ctx.paths.manualDeals, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return { deals: [], notes: ['no manual deals file'] };
    throw e;
  }
  return { deals: manualToDeals(items, ctx.coastalZips), notes: [`${items.length} manual deals`] };
}
