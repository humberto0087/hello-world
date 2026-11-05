import { fixAndFlip, construction, dscr } from './finance.js';

const CFG = window.DEAL_DESK_CONFIG || {};
const CATS = {
  fix_flip: { label: 'Fix & Flip', color: 'var(--flip)' },
  new_construction: { label: 'New Construction', color: 'var(--new)' },
  coastal: { label: 'Coastal / CCC', color: 'var(--coastal)' },
  multifamily: { label: 'Multifamily', color: 'var(--multi)' },
};
const STATUSES = ['', 'Reviewing', 'Sent to buyer', 'Touring', 'Offer out', 'In escrow', 'Loan in process', 'Closed', 'Pass'];

// ---------- storage ----------
const store = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem(`dd:${key}`)) ?? fallback; } catch { return fallback; } },
  set(key, v) { localStorage.setItem(`dd:${key}`, JSON.stringify(v)); },
};
let buyers = store.get('buyers', []);
let pipeline = store.get('pipeline', {}); // dealId -> {status, notes, buyerIds, updated, snapshot}
let myDeals = store.get('myDeals', []);
let feed = { deals: [], sources: {} };
let activeCats = new Set();

// ---------- utils ----------
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => (n === null || n === undefined || Number.isNaN(n) ? '—' : (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString());
const pct = (n, d = 1) => (n === null || n === undefined || !Number.isFinite(n) ? '—' : `${n.toFixed(d)}%`);
const fmtDate = (s) => (s ? new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const allDeals = () => [...myDeals.map((d) => ({ ...d, mine: true })), ...feed.deals];
const dealById = (id) => allDeals().find((d) => d.id === id) || pipeline[id]?.snapshot;
const mapsUrl = (d) => (d.lat && d.lng ? `https://www.google.com/maps?q=${d.lat},${d.lng}` : d.address ? `https://www.google.com/maps/search/${encodeURIComponent(d.address)}` : null);
const dealValue = (d) => d.price ?? d.valuation ?? null;

// ---------- matching ----------
export function buyerMatches(b, d) {
  if (b.cats?.length && !b.cats.some((c) => d.categories.includes(c))) return false;
  const v = d.price;
  if (v && b.minPrice && v < b.minPrice) return false;
  if (v && b.maxPrice && v > b.maxPrice) return false;
  if (b.minUnits && (d.units || 0) < b.minUnits) return false;
  if (b.areas) {
    const areas = b.areas.split(',').map((a) => a.trim().toLowerCase()).filter(Boolean);
    const hay = `${d.zip || ''} ${d.city || ''} ${d.address || ''}`.toLowerCase();
    if (areas.length && !areas.some((a) => hay.includes(a))) return false;
  }
  return true;
}

// ---------- feed ----------
async function loadFeed() {
  try {
    const res = await fetch(`data/deals.json?t=${Date.now()}`);
    if (!res.ok) throw new Error(res.status);
    feed = await res.json();
  } catch {
    feed = { deals: [], sources: {} };
  }
  const active = feed.deals.filter((d) => d.active !== false).length;
  $('#feed-meta').innerHTML = feed.generatedAt
    ? `Last scan <b>${esc(new Date(feed.generatedAt).toLocaleString())}</b> · ${active} active deals · ${feed.deals.filter((d) => d.isNew).length} new this scan`
    : 'No scan has run yet. Once the GitHub Action runs, deals appear here automatically.';
  renderAll();
}

function renderAll() { renderStats(); renderDeals(); renderBuyers(); renderPipeline(); renderSources(); }

function renderStats() {
  const deals = allDeals().filter((d) => d.active !== false);
  $('#stats').innerHTML = Object.entries(CATS).map(([k, c]) => `
    <button class="stat ${activeCats.has(k) ? 'on' : ''}" data-cat="${k}" style="--c:${c.color}">
      <b>${deals.filter((d) => d.categories.includes(k)).length}</b><span>${c.label}</span>
    </button>`).join('') + `
    <button class="stat" data-cat="" style="--c:var(--muted)"><b>${deals.length}</b><span>All active</span></button>`;
}

function filteredDeals() {
  const f = Object.fromEntries(new FormData($('#filters')));
  const q = (f.q || '').toLowerCase().trim();
  let list = allDeals().filter((d) => {
    if (!f.showInactive && d.active === false) return false;
    if (f.newOnly && !d.isNew && !d.mine) return false;
    if (activeCats.size && !d.categories.some((c) => activeCats.has(c))) return false;
    if (f.kind && d.kind !== f.kind) return false;
    const v = dealValue(d);
    if (f.minPrice && (v ?? 0) < +f.minPrice) return false;
    if (f.maxPrice && v && v > +f.maxPrice) return false;
    if (f.minUnits && (d.units || 0) < +f.minUnits) return false;
    if (q) {
      const hay = [d.title, d.address, d.zip, d.city, d.description, d.permitHolder, d.approvalType, d.apn, d.agent].join(' ').toLowerCase();
      if (!q.split(/\s+/).every((t) => hay.includes(t))) return false;
    }
    return true;
  });
  const by = {
    score: (a, b) => (b.score || 0) - (a.score || 0),
    newest: (a, b) => String(b.listedDate || b.issuedDate || b.firstSeen || '').localeCompare(String(a.listedDate || a.issuedDate || a.firstSeen || '')),
    priceAsc: (a, b) => (dealValue(a) ?? Infinity) - (dealValue(b) ?? Infinity),
    priceDesc: (a, b) => (dealValue(b) ?? -1) - (dealValue(a) ?? -1),
    discount: (a, b) => (b.discountToZipPct ?? -999) - (a.discountToZipPct ?? -999),
  }[f.sort || 'score'];
  return list.sort(by);
}

function tagsHtml(d) {
  return d.categories.map((c) => `<span class="tag ${c}">${esc(CATS[c]?.label || c)}</span>`).join('')
    + (d.coastalExemption ? '<span class="tag hot">CCC exemption</span>' : '')
    + (d.isNew ? '<span class="tag hot">NEW</span>' : '')
    + (d.mine ? '<span class="tag plain">My deal</span>' : '')
    + (d.active === false ? '<span class="tag plain">Off-market</span>' : '')
    + (pipeline[d.id]?.status ? `<span class="tag plain">${esc(pipeline[d.id].status)}</span>` : '');
}

function renderDeals() {
  const list = filteredDeals();
  const MAX = 300;
  $('#deal-count').textContent = `${list.length} deals${list.length > MAX ? ` (showing top ${MAX})` : ''}`;
  if (!list.length) {
    $('#deal-list').innerHTML = `<div class="empty">No deals match. ${feed.generatedAt ? 'Try clearing filters.' : 'The scanner hasn’t produced a feed yet — see the Sources tab.'}</div>`;
    return;
  }
  $('#deal-list').innerHTML = list.slice(0, MAX).map((d) => {
    const v = dealValue(d);
    const matches = buyers.filter((b) => buyerMatches(b, d)).length;
    return `<article class="card deal ${d.active === false ? 'inactive' : ''}" data-id="${esc(d.id)}">
      <div class="row-top"><div class="tags">${tagsHtml(d)}</div><span class="score" title="Opportunity score">${d.score ?? '—'}</span></div>
      <h3>${esc(d.title)}</h3>
      <div class="addr">${esc(d.address || 'Address n/a')}</div>
      <div class="money">${v ? money(v) : '—'} <small class="muted">${d.price ? 'list price' : d.valuation ? 'permit valuation' : ''}</small></div>
      <div class="facts">
        ${d.units ? `<span>${d.units} units</span>` : ''}
        ${d.pricePerSqft ? `<span>$${d.pricePerSqft}/sf</span>` : ''}
        ${d.discountToZipPct ? `<span class="${d.discountToZipPct > 0 ? 'good' : ''}">${d.discountToZipPct}% vs zip $/sf</span>` : ''}
        ${d.yearBuilt ? `<span>Built ${d.yearBuilt}</span>` : ''}
        ${d.daysOnMarket != null ? `<span>${d.daysOnMarket} DOM</span>` : ''}
        ${d.approvalType ? `<span>${esc(d.approvalType)}</span>` : ''}
        ${d.issuedDate ? `<span>Issued ${fmtDate(d.issuedDate)}</span>` : ''}
        <span>${esc(d.sourceLabel || d.source)}</span>
        ${matches ? `<span class="good">${matches} buyer match${matches > 1 ? 'es' : ''}</span>` : ''}
      </div>
    </article>`;
  }).join('');
}

// ---------- deal detail + analyzer ----------
function defaultTab(d) {
  if (d.categories.includes('new_construction')) return 'construction';
  if (d.categories.includes('multifamily')) return 'dscr';
  return 'flip';
}

function field(name, label, value, step = 'any') {
  return `<label>${label}<input type="number" name="${name}" value="${value ?? ''}" step="${step}"></label>`;
}

function analyzerForm(tab, d) {
  const L = CFG.loanDefaults || {};
  const v = dealValue(d) || 0;
  if (tab === 'flip') {
    const x = { ...L.fixFlip };
    const rehab = d.sqft ? Math.round(d.sqft * 90 / 1000) * 1000 : Math.round(v * 0.15 / 1000) * 1000;
    const arv = d.zipMedianPpsf && d.sqft ? d.zipMedianPpsf * d.sqft * 1.08 : v * 1.35;
    return [field('purchase', 'Purchase price', d.price || v), field('rehab', 'Rehab budget', rehab), field('arv', 'After-repair value (ARV)', Math.round(arv / 1000) * 1000),
      field('purchaseLtcPct', 'Purchase LTC %', x.purchaseLtcPct), field('rehabFundedPct', 'Rehab funded %', x.rehabFundedPct), field('maxArvPct', 'Max LTV of ARV %', x.maxArvPct),
      field('ratePct', 'Rate %', x.ratePct), field('pointsPct', 'Points %', x.pointsPct), field('months', 'Hold (months)', x.months),
      field('buyClosingPct', 'Buy closing %', 2), field('sellCostPct', 'Selling costs %', 6), field('holdingMonthly', 'Taxes/ins/utilities per mo', Math.round((v * 0.012 + 2400) / 12))].join('');
  }
  if (tab === 'construction') {
    const x = { ...L.construction };
    const land = d.price || (d.kind === 'project' ? 0 : v);
    const hard = d.kind === 'project' ? (d.valuation || 0) : Math.round((d.units || 1) * 450000);
    return [field('land', 'Land / acquisition', land), field('hard', 'Hard costs', hard), field('soft', 'Soft costs (arch, permits, fees)', Math.round(hard * 0.15)),
      field('completedValue', 'Completed value', Math.round((land + hard * 1.15) * 1.25)), field('ltcPct', 'Max LTC %', x.ltcPct), field('maxLtvPct', 'Max LTV (as-complete) %', x.maxLtvPct),
      field('ratePct', 'Rate %', x.ratePct), field('pointsPct', 'Points %', x.pointsPct), field('months', 'Build term (months)', x.months), field('avgDrawPct', 'Avg. outstanding %', 55)].join('');
  }
  const x = { ...L.dscr };
  const units = d.units || 1;
  return [field('price', 'Purchase price', d.price || v), field('monthlyRent', 'Gross rent / mo', units * 2600), field('otherIncome', 'Other income / mo', 0),
    field('downPct', 'Down payment %', x.downPct), field('ratePct', 'Rate %', x.ratePct), field('amortYears', 'Amortization (yrs)', x.amortYears),
    field('vacancyPct', 'Vacancy %', x.vacancyPct), field('taxRatePct', 'Property tax %', x.taxRatePct), field('insuranceAnnual', 'Insurance / yr', 1500 + units * 900),
    field('hoaMonthly', 'HOA / mo', 0), field('mgmtPct', 'Management %', units >= 5 ? 6 : 0), field('repairsPct', 'Repairs/reserves %', 5), field('utilitiesMonthly', 'Owner-paid utilities / mo', units >= 5 ? units * 60 : 0)].join('');
}

function analyzerResults(tab, inp) {
  const tr = (k, v, cls = '') => `<tr class="${cls}"><td>${k}</td><td>${v}</td></tr>`;
  if (tab === 'flip') {
    const r = fixAndFlip(inp);
    return { r, html: `<table>${[
      tr('Loan amount', money(r.loan), 'big'),
      tr('Loan-to-cost', pct(r.ltcPct)), tr('Loan-to-ARV', pct(r.ltvArvPct)),
      r.limitedByArv ? tr('Note', '<span class="bad">Capped by ARV limit</span>') : '',
      tr('Monthly interest (full draw)', money(r.monthlyInterest)), tr('Est. interest over hold', money(r.interest)), tr('Origination points', money(r.points)),
      tr('Cash to close + rehab', money(r.cashNeeded), 'big'),
      tr('Selling costs', money(r.sellCosts)), tr('All-in cost', money(r.totalCost)),
      tr('Projected profit', `<span class="${r.profit >= 0 ? 'good' : 'bad'}">${money(r.profit)}</span>`, 'big'),
      tr('ROI on cash', pct(r.roiPct)), tr('70% rule max offer', money(r.maxOffer70)),
    ].join('')}</table>` };
  }
  if (tab === 'construction') {
    const r = construction(inp);
    return { r, html: `<table>${[
      tr('Total project cost', money(r.totalCost)),
      tr('Construction loan', money(r.loan), 'big'), tr('Loan-to-cost', pct(r.ltcPct)), tr('Loan-to-value (complete)', pct(r.ltvPct)),
      r.limitedByLtv ? tr('Note', '<span class="bad">Capped by as-complete LTV</span>') : '',
      tr('Origination points', money(r.points)), tr('Interest reserve (est.)', money(r.interestReserve)),
      tr('Equity required', money(r.equity), 'big'),
      tr('Projected profit', `<span class="${(r.profit ?? 0) >= 0 ? 'good' : 'bad'}">${money(r.profit)}</span>`, 'big'), tr('Margin on cost', pct(r.marginPct)),
    ].join('')}</table>` };
  }
  const r = dscr(inp);
  const cls = (x) => (x >= 1.25 ? 'good' : x >= 1 ? '' : 'bad');
  return { r, html: `<table>${[
    tr('Loan amount', money(r.loan), 'big'), tr('Down payment', money(r.downPayment)),
    tr('Monthly P&I', money(r.monthlyPI)), tr('PITIA', money(r.pitia)),
    tr('DSCR (rent / PITIA)', `<span class="${cls(r.dscrRent)}">${r.dscrRent?.toFixed(2) ?? '—'}x</span>`, 'big'),
    tr('DSCR (NOI / debt service)', `<span class="${cls(r.dscrNoi)}">${r.dscrNoi?.toFixed(2) ?? '—'}x</span>`),
    tr('NOI / yr', money(r.noi)), tr('Cap rate', pct(r.capRatePct, 2)),
    tr('Cash flow / mo', `<span class="${r.cashFlowMonthly >= 0 ? 'good' : 'bad'}">${money(r.cashFlowMonthly)}</span>`),
    tr('Cash-on-cash', pct(r.cashOnCashPct)), tr('Max loan at 1.25x NOI', money(r.maxLoanAt125)),
  ].join('')}</table>` };
}

let current = { deal: null, tab: 'flip', last: null };

function openDeal(id) {
  const d = dealById(id);
  if (!d) return;
  current = { deal: d, tab: defaultTab(d), last: null };
  const p = pipeline[d.id] || {};
  const matches = buyers.filter((b) => buyerMatches(b, d));
  const facts = [
    ['List price', d.price ? money(d.price) : null], ['Permit valuation', d.valuation ? money(d.valuation) : null],
    ['Units', d.units], ['Sq ft', d.sqft?.toLocaleString()], ['Lot', d.lotSize ? `${d.lotSize.toLocaleString()} sf` : null],
    ['Year built', d.yearBuilt], ['Beds / baths', d.bedrooms != null ? `${d.bedrooms} / ${d.bathrooms ?? '?'}` : null],
    ['$/sf', d.pricePerSqft ? `$${d.pricePerSqft} (zip median $${d.zipMedianPpsf ?? '?'})` : null],
    ['Days on market', d.daysOnMarket], ['Listed', d.listedDate && fmtDate(d.listedDate)],
    ['Approval type', d.approvalType], ['Status', d.status], ['Issued', d.issuedDate && fmtDate(d.issuedDate)], ['Applied', d.createdDate && fmtDate(d.createdDate)],
    ['Permit holder', d.permitHolder], ['APN', d.apn], ['Listing agent', [d.agent, d.agentPhone, d.agentEmail].filter(Boolean).join(' · ')], ['Office', d.office],
    ['First seen', fmtDate(d.firstSeen)], ['Source', d.sourceLabel || d.source],
  ].filter(([, v]) => v !== null && v !== undefined && v !== '');

  $('#deal-detail').innerHTML = `
    <div class="detail-head">
      <div><div class="tags">${tagsHtml(d)}</div><h2>${esc(d.title)}</h2><div class="muted">${esc(d.address || '')}</div></div>
      <button class="btn" data-close>✕</button>
    </div>
    <div class="kv">${facts.map(([k, v]) => `<div><span>${esc(k)}</span>${esc(v)}</div>`).join('')}</div>
    ${d.description ? `<p>${esc(d.description)}</p>` : ''}
    ${d.priceHistory?.length ? `<p class="muted">Price changes: ${d.priceHistory.map((h) => `${esc(h.date)} ${money(h.from)} → ${money(h.to)}`).join('; ')}</p>` : ''}
    ${d.categories.includes('coastal') ? `<p class="muted">Coastal: ${d.coastalExemption ? 'This approval references a Coastal Development Permit exemption/waiver.' : 'Zip is in or near the Coastal Zone.'} Confirm jurisdiction (City LCP vs. Coastal Commission) and exemption status before advising a buyer.</p>` : ''}
    <div class="row-top">
      ${d.url ? `<a class="btn sm" href="${esc(d.url)}" target="_blank" rel="noopener">Open source record</a>` : ''}
      ${mapsUrl(d) ? `<a class="btn sm" href="${esc(mapsUrl(d))}" target="_blank" rel="noopener">Map</a>` : ''}
      ${d.apn ? `<a class="btn sm" href="https://arcc.sdcounty.ca.gov/" target="_blank" rel="noopener">County assessor</a>` : ''}
      ${d.mine ? '<button class="btn sm" data-delete-mine>Delete my deal</button>' : ''}
    </div>

    <div class="subtabs">
      <button data-tab="flip">Fix &amp; flip loan</button>
      <button data-tab="construction">Construction loan</button>
      <button data-tab="dscr">DSCR / multifamily</button>
    </div>
    <form class="analyzer" id="analyzer" onsubmit="return false"><div class="inputs"></div><div class="results"></div></form>
    <p class="disclaimer">Estimates only — not a commitment to lend. Terms depend on borrower experience, credit, liquidity, appraisal and lender guidelines.</p>

    <h3>Pipeline</h3>
    <div class="row-top">
      <select id="p-status">${STATUSES.map((s) => `<option ${p.status === s ? 'selected' : ''} value="${esc(s)}">${s || '— not tracked —'}</option>`).join('')}</select>
    </div>
    <textarea id="p-notes" rows="2" style="width:100%;margin-top:6px" placeholder="Notes (seller motivation, lender feedback…)">${esc(p.notes || '')}</textarea>

    <h3>Matching buyers (${matches.length})</h3>
    ${matches.length ? `<ul class="matches">${matches.map((b) => `<li><b>${esc(b.name)}</b> ${esc(b.email || '')} <button class="btn sm" data-email="${esc(b.id)}">Email deal + loan quote</button></li>`).join('')}</ul>` : '<p class="muted">No saved buyers match this deal’s strategy, price, units and area.</p>'}
  `;
  setTab(current.tab);
  const dlg = $('#deal-dialog');
  if (!dlg.open) dlg.showModal();
}

function setTab(tab) {
  current.tab = tab;
  document.querySelectorAll('#deal-detail .subtabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('#analyzer .inputs').innerHTML = analyzerForm(tab, current.deal);
  recalc();
}

function recalc() {
  const inp = Object.fromEntries([...$('#analyzer').querySelectorAll('input')].map((i) => [i.name, parseFloat(i.value) || 0]));
  const { r, html } = analyzerResults(current.tab, inp);
  current.last = { inp, r };
  $('#analyzer .results').innerHTML = html;
}

function savePipeline(d, patch) {
  const prev = pipeline[d.id] || {};
  const next = { ...prev, ...patch, updated: new Date().toISOString(), snapshot: { ...d } };
  if (!next.status && !next.notes) delete pipeline[d.id]; else pipeline[d.id] = next;
  store.set('pipeline', pipeline);
}

function emailBuyer(buyerId) {
  const b = buyers.find((x) => x.id === buyerId);
  const d = current.deal;
  if (!b || !d) return;
  const { inp, r } = current.last || {};
  const lines = [
    `Hi ${b.name.split(' ')[0]},`, '',
    `I found a deal that fits what you're looking for:`, '',
    `${d.title}`, d.address || '', `Categories: ${d.categories.map((c) => CATS[c]?.label || c).join(', ')}${d.coastalExemption ? ' (Coastal exemption)' : ''}`,
    d.price ? `Price: ${money(d.price)}` : d.valuation ? `Permit valuation: ${money(d.valuation)}` : '',
    d.units ? `Units: ${d.units}` : '', d.url ? `Record: ${d.url}` : '', '',
  ];
  if (r && current.tab === 'flip') lines.push('Financing snapshot (fix & flip):', `- Loan: ${money(r.loan)} (${pct(r.ltcPct)} LTC, ${pct(r.ltvArvPct)} of ARV ${money(inp.arv)})`, `- Rate ${inp.ratePct}% / ${inp.pointsPct} pts, ${inp.months} months`, `- Est. cash needed: ${money(r.cashNeeded)}`, `- Projected profit: ${money(r.profit)}`);
  if (r && current.tab === 'construction') lines.push('Financing snapshot (construction):', `- Loan: ${money(r.loan)} (${pct(r.ltcPct)} LTC)`, `- Rate ${inp.ratePct}% / ${inp.pointsPct} pts, ${inp.months} months`, `- Est. equity required: ${money(r.equity)}`);
  if (r && current.tab === 'dscr') lines.push('Financing snapshot (DSCR):', `- Loan: ${money(r.loan)} with ${inp.downPct}% down at ${inp.ratePct}%`, `- P&I ${money(r.monthlyPI)}/mo, DSCR ${r.dscrRent?.toFixed(2)}x`, `- Cap rate ${pct(r.capRatePct, 2)}`);
  lines.push('', 'Estimates only, subject to underwriting. Want me to set up a showing and get you pre-qualified?', '', CFG.agentName || '', CFG.companyName || '', CFG.licenseLine || '', [CFG.phone, CFG.email].filter(Boolean).join(' · '));
  const subject = `Deal: ${d.title}${d.address ? ` – ${d.address}` : ''}`;
  location.href = `mailto:${encodeURIComponent(b.email || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n'))}`;
  const p = pipeline[d.id] || {};
  savePipeline(d, { status: p.status && p.status !== 'Reviewing' ? p.status : 'Sent to buyer', buyerIds: [...new Set([...(p.buyerIds || []), b.id])] });
  renderDeals(); renderPipeline();
}

// ---------- buyers ----------
function renderBuyers() {
  const deals = allDeals().filter((d) => d.active !== false);
  $('#buyer-list').innerHTML = buyers.length ? buyers.map((b) => {
    const m = deals.filter((d) => buyerMatches(b, d));
    return `<div class="card buyer">
      <div class="row-top"><h3>${esc(b.name)}</h3><span class="score">${m.length} matches</span></div>
      <div class="muted">${esc([b.email, b.phone].filter(Boolean).join(' · '))}</div>
      <div class="tags" style="margin:6px 0">${(b.cats || []).map((c) => `<span class="tag ${c}">${esc(CATS[c]?.label)}</span>`).join('')}${(b.loans || []).map((l) => `<span class="tag plain">${esc(l)}</span>`).join('')}</div>
      <div class="muted">${[b.minPrice || b.maxPrice ? `${money(b.minPrice || 0)} – ${b.maxPrice ? money(b.maxPrice) : 'any'}` : '', b.minUnits ? `${b.minUnits}+ units` : '', b.areas, b.liquidity ? `Liquidity ${money(b.liquidity)}` : ''].filter(Boolean).map(esc).join(' · ')}</div>
      ${b.notes ? `<p>${esc(b.notes)}</p>` : ''}
      <div class="row-top">
        <button class="btn sm" data-edit-buyer="${esc(b.id)}">Edit</button>
        <button class="btn sm" data-show-matches="${esc(b.id)}">Show matches</button>
        <button class="btn sm" data-del-buyer="${esc(b.id)}">Delete</button>
      </div>
    </div>`;
  }).join('') : '<div class="empty">Add your buyers and borrowers. Each deal will show which buyers it fits, and you can email them the deal with a loan quote.</div>';
}

function buyerFromForm(form) {
  const fd = new FormData(form);
  return {
    id: fd.get('id') || crypto.randomUUID(),
    name: fd.get('name').trim(), email: fd.get('email').trim(), phone: fd.get('phone').trim(),
    cats: fd.getAll('cat'), loans: fd.getAll('loan'),
    minPrice: +fd.get('minPrice') || null, maxPrice: +fd.get('maxPrice') || null,
    minUnits: +fd.get('minUnits') || null, liquidity: +fd.get('liquidity') || null,
    areas: fd.get('areas').trim(), notes: fd.get('notes').trim(),
  };
}

function fillBuyerForm(b) {
  const f = $('#buyer-form');
  f.reset();
  for (const k of ['id', 'name', 'email', 'phone', 'minPrice', 'maxPrice', 'minUnits', 'liquidity', 'areas', 'notes']) f.elements[k].value = b[k] ?? '';
  f.querySelectorAll('[name=cat]').forEach((c) => { c.checked = (b.cats || []).includes(c.value); });
  f.querySelectorAll('[name=loan]').forEach((c) => { c.checked = (b.loans || []).includes(c.value); });
  f.elements.name.focus();
}

// ---------- pipeline ----------
function renderPipeline() {
  const rows = Object.entries(pipeline).sort((a, b) => STATUSES.indexOf(a[1].status) - STATUSES.indexOf(b[1].status));
  $('#pipeline').innerHTML = rows.length ? `<table class="list"><thead><tr><th>Status</th><th>Deal</th><th>Value</th><th>Buyers</th><th>Notes</th><th>Updated</th></tr></thead><tbody>
    ${rows.map(([id, p]) => {
      const d = dealById(id) || p.snapshot || {};
      const bs = (p.buyerIds || []).map((bid) => buyers.find((b) => b.id === bid)?.name).filter(Boolean).join(', ');
      return `<tr><td>${esc(p.status || '—')}</td><td><a href="#" data-open="${esc(id)}">${esc(d.title || id)}</a><div class="muted">${esc(d.address || '')}</div></td>
        <td>${money(dealValue(d))}</td><td>${esc(bs)}</td><td>${esc(p.notes || '')}</td><td>${fmtDate(p.updated)}</td></tr>`;
    }).join('')}</tbody></table>` : '<div class="empty">Set a status on any deal to track it here.</div>';
}

// ---------- sources ----------
function renderSources() {
  const s = feed.sources || {};
  $('#sources').innerHTML = `<table class="list"><thead><tr><th>Source</th><th>Enabled</th><th>Last success</th><th>Deals</th><th>Last error</th></tr></thead><tbody>
    ${Object.entries(s).map(([k, v]) => `<tr><td><b>${esc(v.label || k)}</b><div class="muted">${esc((v.notes || []).join(' | ')).slice(0, 400)}</div></td>
      <td>${v.enabled ? 'Yes' : 'No'}</td><td>${fmtDate(v.lastSuccess)}</td><td>${v.lastCount ?? '—'}</td><td class="bad">${esc(v.lastError || '')}</td></tr>`).join('') || '<tr><td colspan="5">No scan yet.</td></tr>'}
    </tbody></table>
    <p class="muted">The scanner runs on a schedule via GitHub Actions (<code>.github/workflows/scan.yml</code>). Add a <code>RENTCAST_API_KEY</code> repository secret to include for-sale listings. Off-market deals go in <code>data/manual-deals.json</code>.</p>`;
}

// ---------- my deals ----------
function exportFile(name, data) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------- events ----------
document.querySelector('.tabs').addEventListener('click', (e) => {
  const v = e.target.dataset.view;
  if (!v) return;
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  document.querySelectorAll('.view').forEach((s) => s.classList.toggle('active', s.id === `view-${v}`));
});

$('#stats').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cat]');
  if (!b) return;
  const c = b.dataset.cat;
  if (!c) activeCats.clear(); else if (activeCats.has(c)) activeCats.delete(c); else activeCats.add(c);
  renderStats(); renderDeals();
});
$('#filters').addEventListener('input', renderDeals);
$('#deal-list').addEventListener('click', (e) => { const c = e.target.closest('.deal'); if (c) openDeal(c.dataset.id); });
$('#pipeline').addEventListener('click', (e) => { const a = e.target.closest('[data-open]'); if (a) { e.preventDefault(); openDeal(a.dataset.open); } });

const dlg = $('#deal-dialog');
dlg.addEventListener('click', (e) => {
  if (e.target === dlg || e.target.closest('[data-close]')) { dlg.close(); return; }
  const t = e.target.closest('[data-tab]'); if (t) setTab(t.dataset.tab);
  const em = e.target.closest('[data-email]'); if (em) emailBuyer(em.dataset.email);
  if (e.target.closest('[data-delete-mine]') && confirm('Delete this deal?')) {
    myDeals = myDeals.filter((d) => d.id !== current.deal.id); store.set('myDeals', myDeals); dlg.close(); renderAll();
  }
});
dlg.addEventListener('input', (e) => {
  if (e.target.closest('#analyzer')) recalc();
  if (e.target.id === 'p-notes') savePipeline(current.deal, { notes: e.target.value });
});
dlg.addEventListener('change', (e) => {
  if (e.target.id === 'p-status') { savePipeline(current.deal, { status: e.target.value }); renderDeals(); renderPipeline(); }
});
dlg.addEventListener('close', () => { renderDeals(); renderPipeline(); });

$('#buyer-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const b = buyerFromForm(e.target);
  const i = buyers.findIndex((x) => x.id === b.id);
  if (i >= 0) buyers[i] = b; else buyers.push(b);
  store.set('buyers', buyers);
  e.target.reset();
  e.target.elements.id.value = '';
  renderBuyers(); renderDeals();
});
$('#buyer-list').addEventListener('click', (e) => {
  const ed = e.target.closest('[data-edit-buyer]'); if (ed) fillBuyerForm(buyers.find((b) => b.id === ed.dataset.editBuyer));
  const del = e.target.closest('[data-del-buyer]');
  if (del && confirm('Delete this buyer?')) { buyers = buyers.filter((b) => b.id !== del.dataset.delBuyer); store.set('buyers', buyers); renderBuyers(); renderDeals(); }
  const sm = e.target.closest('[data-show-matches]');
  if (sm) {
    const b = buyers.find((x) => x.id === sm.dataset.showMatches);
    activeCats = new Set(b.cats || []);
    const f = $('#filters');
    f.elements.minPrice.value = b.minPrice || ''; f.elements.maxPrice.value = b.maxPrice || ''; f.elements.minUnits.value = b.minUnits || '';
    f.elements.q.value = '';
    document.querySelector('.tabs [data-view=deals]').click();
    renderStats(); renderDeals();
  }
});

$('#export-data').addEventListener('click', () => exportFile(`deal-desk-backup-${new Date().toISOString().slice(0, 10)}.json`, { buyers, pipeline, myDeals }));
$('#import-data').addEventListener('change', async (e) => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!confirm('Replace buyers, pipeline and my deals in this browser with the backup?')) return;
    buyers = data.buyers || []; pipeline = data.pipeline || {}; myDeals = data.myDeals || [];
    store.set('buyers', buyers); store.set('pipeline', pipeline); store.set('myDeals', myDeals);
    renderAll();
  } catch (err) { alert(`Could not import: ${err.message}`); }
  e.target.value = '';
});

$('#add-deal-btn').addEventListener('click', () => { $('#add-form').reset(); $('#add-dialog').showModal(); });
$('#add-dialog').addEventListener('close', () => {
  if ($('#add-dialog').returnValue !== 'save') return;
  const fd = new FormData($('#add-form'));
  const d = {
    id: `mine:${crypto.randomUUID()}`, source: 'mine', sourceLabel: 'My deal', kind: 'listing',
    title: fd.get('title'), address: fd.get('address') || null, city: fd.get('city') || null, zip: fd.get('zip') || null,
    price: +fd.get('price') || null, units: +fd.get('units') || null,
    categories: fd.getAll('cat'), coastalExemption: fd.get('coastalExemption') === 'on',
    description: fd.get('description') || null, url: fd.get('url') || null,
    firstSeen: new Date().toISOString(), active: true, score: 50,
  };
  if (!d.categories.length) d.categories = ['fix_flip'];
  myDeals.unshift(d); store.set('myDeals', myDeals); renderAll();
});
$('#export-manual').addEventListener('click', () => {
  exportFile('manual-deals.json', myDeals.map(({ id, source, sourceLabel, score, active, mine, ...rest }) => ({ id: id.replace(/^mine:/, ''), ...rest })));
});

// ---------- boot ----------
$('#brand-name').textContent = CFG.companyName || 'San Diego Deal Desk';
document.title = CFG.companyName || document.title;
$('#footer').textContent = [CFG.agentName, CFG.companyName, CFG.licenseLine, CFG.phone, CFG.email].filter(Boolean).join(' · ');
loadFeed();
setInterval(loadFeed, 15 * 60 * 1000); // pick up new scans while the tab stays open
