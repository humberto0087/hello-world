import { buildToOwn } from './finance.js';

const CFG = window.DEAL_DESK_CONFIG || {};
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => (n === null || n === undefined || !Number.isFinite(n) ? '—' : (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString());

const CATS = {
  fix_flip: 'Fix & Flip',
  new_construction: 'Build / New Construction',
  coastal: 'Coastal',
  multifamily: 'Multifamily',
};

// ---------- branding ----------
document.querySelectorAll('[data-brand]').forEach((el) => { el.textContent = CFG.companyName || el.textContent; });
if (CFG.tagline) $('[data-tagline]').textContent = CFG.tagline;
document.title = CFG.companyName || document.title;
$('[data-brand-footer]').innerHTML = [
  `<b>${esc(CFG.companyName || '')}</b>`,
  esc([CFG.agentName, CFG.licenseLine].filter(Boolean).join(' · ')),
  [CFG.phone && `<a href="tel:${esc(CFG.phone.replace(/[^\d+]/g, ''))}">${esc(CFG.phone)}</a>`, CFG.email && `<a href="mailto:${esc(CFG.email)}">${esc(CFG.email)}</a>`].filter(Boolean).join(' · '),
  esc(CFG.serviceArea ? `Serving ${CFG.serviceArea}` : ''),
].filter(Boolean).join('<br>');
if (CFG.calendarUrl) {
  const a = document.querySelector('.hero .btn.primary');
  a.href = CFG.calendarUrl; a.target = '_blank'; a.rel = 'noopener';
}

// ---------- service paths pre-select the goal ----------
document.querySelectorAll('.path[data-goal]').forEach((p) => p.addEventListener('click', () => {
  $('#intake [name=goal]').value = p.dataset.goal.replace('&amp;', '&');
}));

// ---------- dream home calculator ----------
const calc = $('#build-calc');
function recalc() {
  const v = Object.fromEntries([...calc.querySelectorAll('input, select')].map((i) => [i.name, parseFloat(i.value) || 0]));
  const r = buildToOwn({ ...CFG.loanDefaults?.build, ...v, lotOwned: v.lotOwned === 1 });
  const tr = (k, val, cls = '') => `<tr class="${cls}"><td>${k}</td><td>${val}</td></tr>`;
  $('.results', calc).innerHTML = `<table>${[
    tr('Construction cost (incl. design, permits, contingency)', money(r.buildCost)),
    tr('Total project cost', money(r.totalCost)),
    tr('One-time-close construction loan', money(r.loan)),
    tr('Estimated cash needed', money(r.cashNeeded), 'big'),
    tr('Monthly payment after move-in*', money(r.monthlyAfter), 'big'),
    tr('Equity created by building', `<span class="${(r.equityCreated ?? 0) >= 0 ? 'good' : 'bad'}">${money(r.equityCreated)}</span>`, 'big'),
    tr('Your total equity at move-in', money(r.equityAtCompletion)),
  ].join('')}</table><p class="muted small">*Principal, interest, property tax and insurance. ${v.lotOwned === 1 ? 'Land you own counts toward your down payment.' : ''}</p>`;
}
calc.addEventListener('input', recalc);
recalc();

// ---------- featured opportunities ----------
let deals = [];
let chip = '';
function renderFeatured() {
  const list = deals.filter((d) => !chip || d.categories.includes(chip)).slice(0, 9);
  $('#featured').innerHTML = list.length ? list.map((d) => `
    <article class="card deal">
      <div class="tags">${d.categories.map((c) => `<span class="tag ${c}">${esc(CATS[c] || c)}</span>`).join('')}${d.coastalExemption ? '<span class="tag hot">Coastal exemption</span>' : ''}</div>
      <h3>${esc(d.title)}</h3>
      <div class="addr">${esc([d.city, d.zip].filter(Boolean).join(' '))}</div>
      <div class="money">${d.price ? money(d.price) : 'Price on request'}</div>
      <div class="facts">
        ${d.units ? `<span>${d.units} units</span>` : ''}
        ${d.sqft ? `<span>${d.sqft.toLocaleString()} sf</span>` : ''}
        ${d.lotSize ? `<span>${d.lotSize.toLocaleString()} sf lot</span>` : ''}
        ${d.yearBuilt ? `<span>Built ${d.yearBuilt}</span>` : ''}
        ${d.discountToZipPct > 0 ? `<span class="good">${d.discountToZipPct}% below area $/sf</span>` : ''}
      </div>
      <button class="btn sm ask" data-ask="${esc(d.id)}">Ask about this</button>
    </article>`).join('')
    : '<div class="empty">New opportunities are added daily. Tell us what you\'re looking for and we\'ll send you matches as soon as they come up.</div>';
}
$('#deal-chips').innerHTML = [['', 'All'], ...Object.entries(CATS)].map(([k, l]) => `<button class="chip ${k === chip ? 'on' : ''}" data-chip="${k}">${esc(l)}</button>`).join('');
$('#deal-chips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-chip]'); if (!b) return;
  chip = b.dataset.chip;
  document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === b));
  renderFeatured();
});
$('#featured').addEventListener('click', (e) => {
  const b = e.target.closest('[data-ask]'); if (!b) return;
  const d = deals.find((x) => x.id === b.dataset.ask);
  const f = $('#intake');
  f.elements.dealOfInterest.value = `${d.id} | ${d.title} | ${[d.city, d.zip].filter(Boolean).join(' ')} | ${d.price ? money(d.price) : ''}`;
  $('#deal-ref').textContent = `Asking about: ${d.title}${d.city ? `, ${d.city}` : ''}${d.price ? ` (${money(d.price)})` : ''}`;
  if (!f.elements.goal.value) {
    f.elements.goal.value = d.categories.includes('multifamily') ? 'Multifamily / grow a portfolio'
      : d.categories.includes('fix_flip') ? 'Fix & flip'
        : d.categories.includes('new_construction') ? 'Build my dream home' : '';
  }
  $('#start').scrollIntoView({ behavior: 'smooth' });
});

fetch(`data/deals.json?t=${Date.now()}`).then((r) => (r.ok ? r.json() : { deals: [] })).catch(() => ({ deals: [] })).then((feed) => {
  // Only show for-sale and manually curated deals publicly; permit-holder leads stay internal.
  deals = (feed.deals || []).filter((d) => d.kind !== 'project' && d.active !== false).sort((a, b) => (b.score || 0) - (a.score || 0));
  renderFeatured();
});

// ---------- intake ----------
$('#intake').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const status = $('#intake-status');
  const lead = { type: 'website-intake', submittedAt: new Date().toISOString(), ...Object.fromEntries(new FormData(f)) };
  delete lead.consent;
  lead.consentToContact = true;
  status.className = ''; status.textContent = 'Sending…';
  try {
    if (CFG.intakeEndpoint) {
      const res = await fetch(CFG.intakeEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(lead) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      status.className = 'ok';
      status.innerHTML = `Thanks, ${esc(lead.name.split(' ')[0])}! We'll be in touch within one business day.${CFG.calendarUrl ? ` Or <a href="${esc(CFG.calendarUrl)}" target="_blank" rel="noopener">book a time now</a>.` : ''}`;
      f.reset(); $('#deal-ref').textContent = '';
    } else if (CFG.email) {
      const readable = Object.entries(lead).filter(([k, v]) => v && k !== 'type').map(([k, v]) => `${k}: ${v}`).join('\n');
      const body = `${readable}\n\n---\nLEAD-DATA: ${JSON.stringify(lead)}`;
      location.href = `mailto:${encodeURIComponent(CFG.email)}?subject=${encodeURIComponent(`New inquiry: ${lead.goal} – ${lead.name}`)}&body=${encodeURIComponent(body)}`;
      status.className = 'ok';
      status.textContent = 'Your email app should open with your details filled in. Just press send.';
    } else {
      throw new Error('This form is not connected yet.');
    }
  } catch (err) {
    status.className = 'err';
    status.textContent = `Sorry, that didn't go through (${err.message}).${CFG.phone ? ` Please call ${CFG.phone}.` : ''}`;
  }
});
