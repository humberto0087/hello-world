// City of San Diego Development Services approvals, published as open data at
// https://data.sandiego.gov/datasets/development-permits-set2/
// Every permit/approval is a project lead: owners and developers who are building,
// renovating or pulling coastal approvals and will need acquisition, construction,
// bridge or take-out financing.

import { parseCsv } from '../lib/csv.js';
import { classifyText, isCoastalZip } from '../lib/classify.js';

const FIELD = {
  approvalId: ['approval_id', 'approvalid'],
  projectId: ['project_id', 'projectid'],
  type: ['approval_type', 'approval_type_desc', 'type'],
  category: ['approval_category', 'category'],
  status: ['approval_status', 'status'],
  scope: ['approval_scope', 'scope'],
  projectScope: ['project_scope'],
  title: ['project_title', 'title'],
  issued: ['approval_issue_date', 'date_approval_issue', 'date_issued', 'issue_date'],
  created: ['approval_create_date', 'date_approval_create', 'project_create_date', 'date_project_create', 'date_created'],
  valuation: ['approval_valuation', 'valuation', 'job_valuation'],
  holder: ['approval_permit_holder', 'permit_holder'],
  address: ['address_job', 'job_address', 'gis_address', 'address'],
  apn: ['gis_apn', 'job_apn', 'apn'],
  lat: ['gis_latitude', 'lat_job', 'latitude', 'lat'],
  lng: ['gis_longitude', 'lng_job', 'longitude', 'lng', 'lon'],
  units: ['approval_du_net_change', 'approval_units', 'dwelling_units', 'units'],
  stories: ['approval_stories'],
  floorArea: ['approval_floor_area'],
  projectType: ['project_type'],
};

export function pick(row, key) {
  for (const k of FIELD[key]) {
    if (row[k] !== undefined && row[k] !== '') return row[k];
  }
  return '';
}

const num = (v) => {
  const n = parseFloat(String(v).replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : null;
};

const toIso = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

// Sub-permits that ride along with a building permit (and duplicate it), or aren't deals.
const TRADE_TYPES = /\b(electrical|plumbing|mechanical|fire pmt|right of way|agreement|no-plan|sign|grading|alternate methods|traffic|encroachment|sewer|water meter|street|public improvement|demolition pmt)\b/i;

// DSD project scopes start with the community plan area, e.g. "PACIFIC BEACH (Process 2) ...".
// Gis addresses usually lack a zip, so this is the main coastal-zone signal.
const COASTAL_COMMUNITY = /\b(la jolla|bird rock|pacific beach|mission beach|ocean beach|point loma|peninsula|sunset cliffs|mission bay|torrey pines|del mar mesa|carmel valley|coronado|tijuana river valley)\b/i;

export function zipFromAddress(addr) {
  const m = String(addr || '').match(/\b(9[12]\d{3})(?:-\d{4})?\b/);
  return m ? m[1] : null;
}

/** Convert one CSV row into a deal, or null if it is not an investment signal. */
export function permitRowToDeal(row, cfg, coastalZips, now = Date.now()) {
  const status = pick(row, 'status');
  if (/\b(cancel\w*|void\w*|withdrawn|denied|expired|closed)\b/i.test(status)) return null;

  const issued = toIso(pick(row, 'issued'));
  const created = toIso(pick(row, 'created'));
  const refDate = issued || created;
  if (!refDate) return null;
  const ageDays = (now - new Date(refDate).getTime()) / 86_400_000;
  if (ageDays > (cfg.lookbackDays ?? 120) || ageDays < -1) return null;

  const type = pick(row, 'type');
  if (TRADE_TYPES.test(type)) return null;
  const scope = [pick(row, 'scope'), pick(row, 'projectScope')].filter(Boolean).join(' — ');
  const title = pick(row, 'title');
  const text = `${type}. ${pick(row, 'category')}. ${title}. ${scope}`;
  const address = pick(row, 'address');
  const zip = zipFromAddress(address);

  const coastalZip = isCoastalZip(zip, coastalZips);
  // Being in a coastal zip alone isn't a lead for permits; require a real signal.
  const c = classifyText(text);
  if (c.noise) return null;
  const categories = new Set(c.categories);
  if (categories.size === 0) return null;
  if (coastalZip || COASTAL_COMMUNITY.test(`${title} ${scope}`)) categories.add('coastal');

  const valuation = num(pick(row, 'valuation'));
  const isCoastalApproval = /coastal/i.test(type) || c.coastalExemption;
  if ((valuation ?? 0) < (cfg.minValuation ?? 0) && !isCoastalApproval && !(c.units >= 2)) return null;

  const approvalId = pick(row, 'approvalId');
  const projectId = pick(row, 'projectId');
  const id = approvalId || projectId || `${address}|${refDate}|${type}`;
  const unitsField = num(pick(row, 'units'));
  const floorArea = num(pick(row, 'floorArea'));
  const stories = num(pick(row, 'stories'));

  return {
    id: `sdcity:${id}`,
    source: 'sdCityPermits',
    sourceLabel: 'City of SD permit',
    kind: 'project',
    title: title || type || 'Permit',
    address: address || null,
    city: 'San Diego',
    zip,
    apn: pick(row, 'apn') || null,
    lat: num(pick(row, 'lat')),
    lng: num(pick(row, 'lng')),
    categories: [...categories],
    coastalExemption: c.coastalExemption,
    units: (unitsField && unitsField > 0 ? unitsField : null) || c.units,
    stories: stories || null,
    sqft: floorArea && floorArea > 0 ? Math.round(floorArea) : null,
    projectId: projectId || null,
    projectType: pick(row, 'projectType') || null,
    approvalId: approvalId || null,
    valuation,
    price: null,
    approvalType: type || null,
    status: status || null,
    description: scope || null,
    permitHolder: pick(row, 'holder') || null,
    issuedDate: issued,
    createdDate: created,
    url: approvalId
      ? `https://opendsd.sandiego.gov/Web/Approvals/Details/${encodeURIComponent(approvalId)}`
      : projectId
        ? `https://opendsd.sandiego.gov/Web/Projects/Details/${encodeURIComponent(projectId)}`
        : null,
  };
}

export const ID_PREFIX = 'sdcity:p:';

const isBuildingType = (t) => /building|combination/i.test(t || '');

/**
 * One lead per DSD project: a 16-building apartment project or a duplex with a
 * coastal permit plus a building permit becomes a single row with its approvals listed.
 */
export function groupByProject(rows) {
  const groups = new Map();
  for (const d of rows) {
    const key = d.projectId || d.approvalId || d.id;
    (groups.get(key) || groups.set(key, []).get(key)).push(d);
  }
  return [...groups.entries()].map(([key, list]) => {
    const first = list.find((d) => d.address) || list[0];
    const cats = new Set(list.flatMap((d) => d.categories));
    const buildings = list.filter((d) => isBuildingType(d.approvalType));
    const sum = (arr, f) => arr.reduce((a, d) => a + (d[f] || 0), 0);
    const maxOf = (f) => list.reduce((a, d) => Math.max(a, d[f] || 0), 0) || null;
    const units = (buildings.length > 1 ? sum(buildings, 'units') : 0) || maxOf('units');
    const valuation = sum(list, 'valuation') || null;
    const typeCounts = {};
    for (const d of list) typeCounts[d.approvalType || 'Permit'] = (typeCounts[d.approvalType || 'Permit'] || 0) + 1;
    const dates = (f) => list.map((d) => d[f]).filter(Boolean).sort();
    return {
      ...first,
      id: `${ID_PREFIX}${key}`,
      categories: [...cats],
      coastalExemption: list.some((d) => d.coastalExemption),
      units: units || null,
      valuation,
      sqft: (buildings.length > 1 ? sum(buildings, 'sqft') : 0) || maxOf('sqft'),
      stories: maxOf('stories'),
      lat: list.find((d) => d.lat != null)?.lat ?? null,
      lng: list.find((d) => d.lng != null)?.lng ?? null,
      apn: list.find((d) => d.apn)?.apn ?? null,
      zip: list.find((d) => d.zip)?.zip ?? null,
      approvalType: Object.entries(typeCounts).map(([t, n]) => (n > 1 ? `${t} ×${n}` : t)).join(', '),
      approvalCount: list.length,
      approvals: list.slice(0, 25).map((d) => ({ id: d.approvalId, type: d.approvalType, status: d.status, issued: d.issuedDate, valuation: d.valuation, url: d.url })),
      issuedDate: dates('issuedDate').pop() || null,
      createdDate: dates('createdDate')[0] || null,
      url: first.projectId ? `https://opendsd.sandiego.gov/Web/Projects/Details/${encodeURIComponent(first.projectId)}` : first.url,
    };
  });
}

export async function run(cfg, ctx) {
  const rows = [];
  const notes = [];
  for (const url of cfg.urls) {
    const res = await ctx.fetch(url);
    if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
    const text = await res.text();
    let kept = 0;
    const { header, count } = parseCsv(text, (row) => {
      const d = permitRowToDeal(row, cfg, ctx.coastalZips, ctx.now);
      if (d) { rows.push(d); kept++; }
    });
    notes.push(`${url}: ${count} rows, ${kept} matching approvals. Columns: ${header.join(',')}`);
  }
  const deals = groupByProject(rows);
  notes.push(`${deals.length} projects`);
  return { deals, notes };
}
