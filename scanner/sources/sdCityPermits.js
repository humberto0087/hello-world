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
  issued: ['date_approval_issue', 'approval_issue_date', 'date_issued', 'issue_date'],
  created: ['date_approval_create', 'date_project_create', 'approval_create_date', 'date_created'],
  valuation: ['approval_valuation', 'valuation', 'job_valuation'],
  holder: ['approval_permit_holder', 'permit_holder'],
  address: ['address_job', 'job_address', 'gis_address', 'address'],
  apn: ['job_apn', 'apn'],
  lat: ['lat_job', 'latitude', 'lat'],
  lng: ['lng_job', 'longitude', 'lng', 'lon'],
  units: ['approval_units', 'dwelling_units', 'units'],
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
  if (coastalZip) categories.add('coastal');

  const valuation = num(pick(row, 'valuation'));
  const isCoastalApproval = /coastal/i.test(type) || c.coastalExemption;
  if ((valuation ?? 0) < (cfg.minValuation ?? 0) && !isCoastalApproval && !(c.units >= 2)) return null;

  const approvalId = pick(row, 'approvalId');
  const projectId = pick(row, 'projectId');
  const id = approvalId || projectId || `${address}|${refDate}|${type}`;
  const unitsField = num(pick(row, 'units'));

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
    units: unitsField || c.units,
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

export async function run(cfg, ctx) {
  const deals = [];
  const notes = [];
  for (const url of cfg.urls) {
    const res = await ctx.fetch(url);
    if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
    const text = await res.text();
    let kept = 0;
    const { header, count } = parseCsv(text, (row) => {
      const d = permitRowToDeal(row, cfg, ctx.coastalZips, ctx.now);
      if (d) { deals.push(d); kept++; }
    });
    notes.push(`${url}: ${count} rows, ${kept} leads. Columns: ${header.slice(0, 40).join(',')}`);
  }
  return { deals, notes };
}
