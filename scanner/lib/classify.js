// Deal classification shared by all sources.
// Categories: fix_flip, new_construction, coastal, multifamily.

export const CATEGORIES = {
  fix_flip: 'Fix & Flip',
  new_construction: 'New Construction',
  coastal: 'Coastal / CCC Exemption',
  multifamily: 'Multifamily',
};

// Work that is not a real estate investment signal on its own.
const NOISE = /\b(photovoltaic|solar|\bpv\b|ev charger|electric vehicle|water heater|sign(age)? permit|\bsign\b|hvac|furnace|fence only|wireless|cell(ular)? (site|tower)|antenna|telecom|backflow|sewer lateral|fire sprinkler|fire alarm|tenant improvement|\bti\b|demo(lition)? only|grading only|traffic control|right[- ]of[- ]way|encroachment|temporary|special event|tree)\b/i;

const RESIDENTIAL = /\b(residen\w*|dwelling|sfr|sfd|single[- ]family|house|home|duplex|triplex|fourplex|four[- ]plex|apartment|condo\w*|townho\w*|units?|du|adu|jadu|companion unit|granny|multi[- ]?family|mixed[- ]use|live[- ]work)\b/i;

const NEW_BUILD = /\b(new|construct(ion)?|erect|build)\b[^.;]{0,60}?\b(single[- ]family|sfr|sfd|dwelling|residen\w*|house|home|duplex|triplex|fourplex|apartments?|building|units?|du|adu|jadu|condo\w*|townho\w*|mixed[- ]use|structure)\b|\b(nsfr|nsfd|new sfr|new sfd)\b|\bground[- ]up\b|\bdemo(lish|lition)?\b[^.;]{0,60}?\b(construct|build|new)\b/i;

const MINOR_NEW = /\b(window|door|roof|water heater|panel|meter|electrical|plumbing|hvac|fence|deck|patio|pool|spa|garage door|driveway|wall|retaining wall|siding|stucco|furnace|fireplace|skylight|cabinet|counter)s?\b|\bexisting\b/i;

function isNewBuild(t) {
  const re = new RegExp(NEW_BUILD.source, 'gi');
  let m;
  while ((m = re.exec(t))) {
    if (!MINOR_NEW.test(m[0])) return true;
  }
  return false;
}

const REHAB = /\b(remodel\w*|renovat\w*|rehab\w*|alteration\w*|repair\w*|kitchen|bath(room)?s?|re-?roof\w*|addition\w*|convert\w*|conversion|restor\w*|upgrade\w*|replace\w* (of )?(windows|siding|stucco|foundation)|foundation repair|dry ?rot|fire damage|water damage)\b/i;

const COASTAL = /\b(coastal|\bcdp\b|ccc|coastal commission|beach impact|sensitive coastal)\b/i;
const EXEMPT = /\bexempt(ion|ed)?\b|\bwaiver\b|\bde minimis\b/i;

const MULTI = /\b(multi[- ]?family|apartments?|duplex|triplex|fourplex|four[- ]plex|quadplex|condo\w*|townho\w*|mixed[- ]use|sb[- ]?9|lot split|density bonus|bonus adu|ab[- ]?2011|sb[- ]?35|sb[- ]?684|small lot subdivision)\b/i;

export function extractUnits(text) {
  if (!text) return null;
  const re = /\b(\d{1,4})\s*[- ]?\s*(dwelling units?|residential units?|units?|du's?|dus|apartments?|townhomes?|condos?|condominiums?)\b/gi;
  let max = null;
  let m;
  while ((m = re.exec(text))) {
    const v = parseInt(m[1], 10);
    if (v > 0 && v < 5000 && (max === null || v > max)) max = v;
  }
  const words = { duplex: 2, triplex: 3, fourplex: 4, 'four-plex': 4, quadplex: 4 };
  for (const [w, v] of Object.entries(words)) {
    if (new RegExp(`\\b${w}\\b`, 'i').test(text) && (max === null || v > max)) max = v;
  }
  return max;
}

/**
 * Classify a free-text project/listing description.
 * @returns {{categories: string[], units: number|null, coastalExemption: boolean, noise: boolean}}
 */
export function classifyText(text, { coastalZip = false } = {}) {
  const t = String(text || '');
  const categories = new Set();
  const units = extractUnits(t);
  const residential = RESIDENTIAL.test(t);
  const noise = NOISE.test(t) && !NEW_BUILD.test(t) && !MULTI.test(t);

  const isNew = residential && isNewBuild(t);
  if (isNew) categories.add('new_construction');

  if ((units !== null && units >= 2) || MULTI.test(t)) categories.add('multifamily');

  if (!isNew && residential && REHAB.test(t)) categories.add('fix_flip');

  const coastalText = COASTAL.test(t);
  const coastalExemption = coastalText && EXEMPT.test(t);
  if (coastalText || coastalZip) categories.add('coastal');

  return { categories: [...categories], units, coastalExemption, noise };
}

export function isCoastalZip(zip, coastalZips) {
  if (!zip) return false;
  const z = String(zip).slice(0, 5);
  return coastalZips.includes(z);
}

/** 0-100 opportunity score used for default sort. */
export function scoreDeal(d, now = Date.now()) {
  let s = 20;
  const cats = d.categories || [];
  s += cats.length * 8;
  if (d.coastalExemption) s += 15;
  if (d.units) s += Math.min(20, d.units * 2);
  const value = d.price || d.valuation || 0;
  if (value >= 5_000_000) s += 15;
  else if (value >= 1_500_000) s += 12;
  else if (value >= 500_000) s += 8;
  else if (value >= 150_000) s += 4;
  const dateStr = d.listedDate || d.issuedDate || d.createdDate || d.firstSeen;
  if (dateStr) {
    const ageDays = (now - new Date(dateStr).getTime()) / 86_400_000;
    if (ageDays <= 7) s += 15;
    else if (ageDays <= 30) s += 10;
    else if (ageDays <= 90) s += 5;
  }
  if (d.discountToZipPct && d.discountToZipPct > 0) s += Math.min(20, Math.round(d.discountToZipPct / 2));
  if (d.daysOnMarket && d.daysOnMarket > 60) s += 5; // motivated seller
  return Math.max(0, Math.min(100, Math.round(s)));
}
