// Active for-sale listings from the RentCast API (https://developers.rentcast.io).
// Requires the RENTCAST_API_KEY secret. Skipped silently when no key is configured.
// Flags: fix & flip (older, priced below zip $/sqft median, or stale on market),
// new construction (new builds and land), multifamily, coastal-zone zips.

import { classifyText, isCoastalZip } from '../lib/classify.js';

const API = 'https://api.rentcast.io/v1/listings/sale';

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function listingsToDeals(listings, coastalZips, now = new Date()) {
  const inCounty = listings.filter((l) => !l.county || /san diego/i.test(l.county));

  // $/sqft medians per zip and property type, for spotting under-priced fixers.
  const groups = {};
  for (const l of inCounty) {
    if (l.price > 0 && l.squareFootage > 300) {
      const k = `${l.zipCode}|${l.propertyType}`;
      (groups[k] ||= []).push(l.price / l.squareFootage);
    }
  }
  const medians = Object.fromEntries(Object.entries(groups).filter(([, v]) => v.length >= 3).map(([k, v]) => [k, median(v)]));
  const year = now.getFullYear();

  return inCounty.map((l) => {
    const type = l.propertyType || '';
    const text = [type, l.description, l.listingType].filter(Boolean).join('. ');
    const c = classifyText(text);
    const cats = new Set(c.categories.filter((x) => x !== 'fix_flip' || /fixer|tlc|as[- ]is|investor|handyman|needs work|contractor special|rehab|estate sale|probate|cash only/i.test(text)));

    const ppsf = l.price && l.squareFootage ? l.price / l.squareFootage : null;
    const med = medians[`${l.zipCode}|${type}`];
    const discountToZipPct = ppsf && med ? Math.round((1 - ppsf / med) * 100) : null;

    if (/multi/i.test(type) || (l.units && l.units >= 2)) cats.add('multifamily');
    if (/land|lot/i.test(type)) cats.add('new_construction');
    if (l.yearBuilt && l.yearBuilt >= year - 1) cats.add('new_construction');
    if (/fixer|tlc|as[- ]is|investor|handyman|needs work|contractor special|probate|estate sale/i.test(text)) cats.add('fix_flip');
    if (/single family|townhouse|condo|multi/i.test(type) && l.yearBuilt && l.yearBuilt < 1985 && discountToZipPct !== null && discountToZipPct >= 15) cats.add('fix_flip');
    if (/single family|townhouse|condo/i.test(type) && (l.daysOnMarket ?? 0) >= 90 && discountToZipPct !== null && discountToZipPct >= 10) cats.add('fix_flip');
    if (isCoastalZip(l.zipCode, coastalZips)) cats.add('coastal');

    if (cats.size === 0 || (cats.size === 1 && cats.has('coastal'))) return null; // plain retail listing

    return {
      id: `rentcast:${l.id || l.formattedAddress}`,
      source: 'rentcast',
      sourceLabel: 'For-sale listing',
      kind: 'listing',
      title: `${type || 'Property'}${l.bedrooms ? ` · ${l.bedrooms}bd/${l.bathrooms ?? '?'}ba` : ''}${l.squareFootage ? ` · ${l.squareFootage.toLocaleString()} sf` : ''}`,
      address: l.formattedAddress || [l.addressLine1, l.city, l.state, l.zipCode].filter(Boolean).join(', '),
      city: l.city || null,
      zip: l.zipCode || null,
      lat: l.latitude ?? null,
      lng: l.longitude ?? null,
      categories: [...cats],
      coastalExemption: false,
      units: l.units || c.units || null,
      price: l.price || null,
      valuation: null,
      sqft: l.squareFootage || null,
      lotSize: l.lotSize || null,
      yearBuilt: l.yearBuilt || null,
      bedrooms: l.bedrooms ?? null,
      bathrooms: l.bathrooms ?? null,
      pricePerSqft: ppsf ? Math.round(ppsf) : null,
      zipMedianPpsf: med ? Math.round(med) : null,
      discountToZipPct,
      daysOnMarket: l.daysOnMarket ?? null,
      listedDate: l.listedDate ? String(l.listedDate).slice(0, 10) : null,
      status: l.status || 'Active',
      description: l.description || null,
      agent: l.listingAgent?.name || null,
      agentPhone: l.listingAgent?.phone || null,
      agentEmail: l.listingAgent?.email || null,
      office: l.listingOffice?.name || null,
      url: null,
    };
  }).filter(Boolean);
}

export async function run(cfg, ctx) {
  const key = ctx.env.RENTCAST_API_KEY;
  if (!key) return { deals: [], notes: ['RENTCAST_API_KEY not set — skipped'], skipped: true };
  const all = [];
  let requests = 0;
  for (const propertyType of cfg.propertyTypes) {
    for (let page = 0; page < cfg.maxPagesPerType; page++) {
      const qs = new URLSearchParams({
        latitude: String(cfg.latitude),
        longitude: String(cfg.longitude),
        radius: String(cfg.radiusMiles),
        propertyType,
        status: 'Active',
        limit: String(cfg.pageSize),
        offset: String(page * cfg.pageSize),
      });
      const res = await ctx.fetch(`${API}?${qs}`, { headers: { 'X-Api-Key': key, Accept: 'application/json' } });
      requests++;
      if (!res.ok) throw new Error(`RentCast ${propertyType} page ${page} -> HTTP ${res.status}`);
      const batch = await res.json();
      all.push(...batch);
      if (batch.length < cfg.pageSize) break;
    }
  }
  const deals = listingsToDeals(all, ctx.coastalZips, new Date(ctx.now));
  return { deals, notes: [`${requests} API requests, ${all.length} listings, ${deals.length} deals`] };
}
