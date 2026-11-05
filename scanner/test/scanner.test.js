import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCsvToArray } from '../lib/csv.js';
import { classifyText, extractUnits, scoreDeal } from '../lib/classify.js';
import { permitRowToDeal, zipFromAddress } from '../sources/sdCityPermits.js';
import { listingsToDeals } from '../sources/rentcast.js';
import { mergeDeals } from '../lib/merge.js';

const config = JSON.parse(readFileSync(new URL('../config.json', import.meta.url)));
const NOW = new Date('2026-11-05T12:00:00Z').getTime();

test('csv parser handles quotes, commas and embedded quotes', () => {
  const rows = parseCsvToArray('A,B,C\r\n1,"x, y","he said ""hi"""\n2,,"multi\nline"\n');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { a: '1', b: 'x, y', c: 'he said "hi"' });
  assert.equal(rows[1].c, 'multi\nline');
});

test('classifyText tags categories', () => {
  assert.deepEqual(classifyText('Construct new single family dwelling').categories, ['new_construction']);
  assert.ok(classifyText('New 24 unit apartment building').categories.includes('multifamily'));
  assert.ok(classifyText('New 24 unit apartment building').categories.includes('new_construction'));
  assert.deepEqual(classifyText('Kitchen remodel of existing residence, new windows').categories, ['fix_flip']);
  const coastal = classifyText('Coastal Development Permit exemption for remodel of existing house');
  assert.ok(coastal.categories.includes('coastal'));
  assert.equal(coastal.coastalExemption, true);
  assert.equal(classifyText('Install rooftop solar PV').noise, true);
  assert.ok(classifyText('Demolish existing house and construct new SFD').categories.includes('new_construction'));
  assert.ok(!classifyText('new windows for existing dwelling').categories.includes('new_construction'));
});

test('extractUnits', () => {
  assert.equal(extractUnits('24 dwelling units'), 24);
  assert.equal(extractUnits('convert to duplex'), 2);
  assert.equal(extractUnits('remodel'), null);
});

test('zipFromAddress', () => {
  assert.equal(zipFromAddress('1 Main St, San Diego, CA 92109-1234'), '92109');
  assert.equal(zipFromAddress('no zip'), null);
});

test('permit rows become leads; noise, cancelled and stale rows are dropped', () => {
  const rows = parseCsvToArray(readFileSync(new URL('./fixtures/permits.csv', import.meta.url), 'utf8'));
  const cfg = config.sources.sdCityPermits;
  const deals = rows.map((r) => permitRowToDeal(r, cfg, config.coastalZips, NOW)).filter(Boolean);
  const ids = deals.map((d) => d.id);
  assert.deepEqual(ids, ['sdcity:1001', 'sdcity:1002', 'sdcity:1004', 'sdcity:1005']);

  const nsfd = deals[0];
  assert.deepEqual(nsfd.categories, ['new_construction']);
  assert.equal(nsfd.zip, '92105');
  assert.equal(nsfd.url, 'https://opendsd.sandiego.gov/Web/Approvals/Details/1001');

  const coastal = deals[1];
  assert.ok(coastal.categories.includes('coastal'));
  assert.equal(coastal.coastalExemption, true); // kept despite $0 valuation

  const apts = deals[2];
  assert.equal(apts.units, 24);
  assert.ok(apts.categories.includes('multifamily'));
  assert.ok(apts.categories.includes('coastal')); // 92101 is a coastal zip

  assert.deepEqual(deals[3].categories, ['fix_flip']);
});

test('listings: fixer below zip median, land, multifamily, plain retail filtered out', () => {
  const base = { county: 'San Diego', zipCode: '92115', propertyType: 'Single Family', yearBuilt: 2000, squareFootage: 1500, price: 900000, daysOnMarket: 10 };
  const listings = [
    { ...base, id: 'a' },
    { ...base, id: 'b', price: 910000 },
    { ...base, id: 'c', price: 890000 },
    { ...base, id: 'fixer', price: 600000, yearBuilt: 1955 },
    { ...base, id: 'kw', description: 'Handyman special, sold as-is' },
    { ...base, id: 'land', propertyType: 'Land', squareFootage: null, price: 400000 },
    { ...base, id: 'mf', propertyType: 'Multi-Family', units: 4, price: 2000000, zipCode: '92109' },
    { ...base, id: 'oc', county: 'Orange', propertyType: 'Land' },
  ];
  const deals = listingsToDeals(listings, config.coastalZips, new Date(NOW));
  const byId = Object.fromEntries(deals.map((d) => [d.id.replace('rentcast:', ''), d]));
  assert.deepEqual(Object.keys(byId).sort(), ['fixer', 'kw', 'land', 'mf']);
  assert.ok(byId.fixer.categories.includes('fix_flip'));
  assert.ok(byId.fixer.discountToZipPct >= 30);
  assert.ok(byId.kw.categories.includes('fix_flip'));
  assert.deepEqual(byId.land.categories, ['new_construction']);
  assert.ok(byId.mf.categories.includes('multifamily') && byId.mf.categories.includes('coastal'));
});

test('merge keeps firstSeen, tracks price changes, ages out unseen deals', () => {
  const t1 = '2026-10-01T00:00:00.000Z';
  const t2 = '2026-11-05T00:00:00.000Z';
  const prev = [
    { id: 'rentcast:1', source: 'rentcast', price: 100, categories: ['fix_flip'], firstSeen: t1, lastSeen: t1, active: true },
    { id: 'rentcast:gone', source: 'rentcast', categories: ['fix_flip'], firstSeen: t1, lastSeen: t1, active: true },
    { id: 'rentcast:old', source: 'rentcast', categories: ['fix_flip'], firstSeen: '2026-01-01T00:00:00Z', lastSeen: '2026-01-01T00:00:00Z' },
    { id: 'sdcity:1', source: 'sdCityPermits', categories: ['new_construction'], firstSeen: t1, lastSeen: t1, active: true },
  ];
  const fresh = [
    { id: 'rentcast:1', source: 'rentcast', price: 90, categories: ['fix_flip'] },
    { id: 'rentcast:2', source: 'rentcast', price: 50, categories: ['multifamily'] },
  ];
  const out = mergeDeals(prev, fresh, { ranSources: new Set(['rentcast']), nowIso: t2, dropAfterDaysUnseen: 45 });
  const m = Object.fromEntries(out.map((d) => [d.id, d]));
  assert.equal(m['rentcast:1'].firstSeen, t1);
  assert.equal(m['rentcast:1'].isNew, false);
  assert.deepEqual(m['rentcast:1'].priceHistory, [{ date: '2026-11-05', from: 100, to: 90 }]);
  assert.equal(m['rentcast:2'].isNew, true);
  assert.equal(m['rentcast:gone'].active, false);
  assert.equal(m['rentcast:old'], undefined);
  assert.equal(m['sdcity:1'].active, true); // source didn't run, carried over
});

test('scoreDeal is bounded and rewards recency and coastal exemptions', () => {
  const a = scoreDeal({ categories: ['coastal'], coastalExemption: true, issuedDate: '2026-11-04' }, NOW);
  const b = scoreDeal({ categories: ['coastal'], issuedDate: '2025-01-01' }, NOW);
  assert.ok(a > b);
  assert.ok(a <= 100 && b >= 0);
});
