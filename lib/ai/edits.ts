import { isIgnorable, normalize, normalizeWithMap } from './normalize';
import type { Edit } from './types';

export type Range = { start: number; end: number };

/** يبحث عن مقطع داخل النص: حرفيًا أولًا، ثم بعد تطبيع التشكيل والتطويل وصور الألف. */
export function findQuote(original: string, quote: string, from = 0): Range | null {
  if (!quote.trim()) return null;

  const exact = original.indexOf(quote, from);
  if (exact !== -1) return { start: exact, end: exact + quote.length };

  const { norm, map } = normalizeWithMap(original);
  const nq = normalize(quote).trim();
  if (nq.length < 2) return null;

  // نحوّل موضع البدء إلى فضاء النص المُطبَّع.
  let normFrom = 0;
  while (normFrom < map.length && map[normFrom] < from) normFrom++;

  const i = norm.indexOf(nq, normFrom);
  if (i === -1) return null;

  const start = map[i];
  let end = map[i + nq.length - 1] + 1;
  while (end < original.length && isIgnorable(original[end])) end++;
  return { start, end };
}

export type ApplyResult = {
  improved: string;
  applied: Edit[];
  rejected: Array<{ edit: Edit; why: 'not_found' | 'noop' | 'overlap' | 'too_short' }>;
  /** مجموع أطوال المقاطع المستبدلة من الأصل. */
  replacedChars: number;
};

/**
 * يطبّق التعديلات على النص الأصلي. كل ما يقع خارج المقاطع المقتبسة يبقى حرفيًا كما هو.
 * اقتباس غير موجود في النص يُرفض (هلوسة)، وكذلك التعديلات المتداخلة.
 */
export function applyEdits(original: string, edits: Edit[]): ApplyResult {
  const rejected: ApplyResult['rejected'] = [];
  const placed: Array<{ edit: Edit; range: Range }> = [];

  for (const edit of edits) {
    if (edit.quote.trim().length < 2) {
      rejected.push({ edit, why: 'too_short' });
      continue;
    }
    if (edit.quote === edit.replacement) {
      rejected.push({ edit, why: 'noop' });
      continue;
    }

    // أول ظهور لا يتداخل مع تعديل سابق.
    let from = 0;
    let found: Range | null = null;
    while (true) {
      const r = findQuote(original, edit.quote, from);
      if (!r) break;
      const clash = placed.some((p) => r.start < p.range.end && p.range.start < r.end);
      if (!clash) {
        found = r;
        break;
      }
      from = r.end;
    }

    if (!found) {
      const anywhere = findQuote(original, edit.quote);
      rejected.push({ edit, why: anywhere ? 'overlap' : 'not_found' });
      continue;
    }
    placed.push({ edit, range: found });
  }

  placed.sort((a, b) => a.range.start - b.range.start);

  let out = '';
  let cursor = 0;
  let replacedChars = 0;
  for (const { edit, range } of placed) {
    out += original.slice(cursor, range.start);
    out += edit.replacement;
    replacedChars += range.end - range.start;
    cursor = range.end;
  }
  out += original.slice(cursor);

  // حذف مقطع بين مسافتين لا يترك مسافة مزدوجة.
  const improved = placed.some((p) => p.edit.replacement === '') ? out.replace(/ {2,}/g, ' ').trim() : out;

  return { improved, applied: placed.map((p) => p.edit), rejected, replacedChars };
}
