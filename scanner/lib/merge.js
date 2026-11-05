import { scoreDeal } from './classify.js';

/**
 * Merge freshly scanned deals into the previous feed.
 * - keeps firstSeen, refreshes lastSeen
 * - deals from sources that ran OK but no longer return them are marked inactive,
 *   then dropped after dropAfterDaysUnseen
 * - deals from sources that were skipped/failed this run are carried over untouched
 */
export function mergeDeals(previous, fresh, { ranSources, nowIso, dropAfterDaysUnseen = 45 }) {
  const prevById = new Map((previous || []).map((d) => [d.id, d]));
  const out = new Map();
  const now = new Date(nowIso).getTime();

  for (const d of fresh) {
    const old = prevById.get(d.id);
    const merged = {
      ...d,
      firstSeen: old?.firstSeen || nowIso,
      lastSeen: nowIso,
      active: true,
    };
    if (old && old.price && d.price && old.price !== d.price) {
      merged.priceHistory = [...(old.priceHistory || []), { date: nowIso.slice(0, 10), from: old.price, to: d.price }];
    } else if (old?.priceHistory) {
      merged.priceHistory = old.priceHistory;
    }
    merged.isNew = !old;
    merged.score = scoreDeal(merged, now);
    out.set(d.id, merged);
  }

  for (const old of previous || []) {
    if (out.has(old.id)) continue;
    if (!ranSources.has(old.source)) { out.set(old.id, { ...old, isNew: false }); continue; }
    const unseenDays = (now - new Date(old.lastSeen).getTime()) / 86_400_000;
    if (unseenDays > dropAfterDaysUnseen) continue;
    out.set(old.id, { ...old, active: false, isNew: false });
  }

  return [...out.values()].sort((a, b) => (b.active - a.active) || (b.score - a.score));
}
