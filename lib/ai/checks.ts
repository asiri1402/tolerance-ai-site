import { scanHarsh } from './lexicon';
import type { ApplyResult } from './edits';
import { normalize } from './normalize';

const EMOJI = /\p{Extended_Pictographic}/gu;
const URL_RE = /https?:\/\/\S+|www\.\S+/gi;
const MENTION_RE = /[@#][\p{L}\p{N}_]+/gu;
const NUMBER_RE = /[0-9٠-٩۰-۹]+(?:[.,٫][0-9٠-٩۰-۹]+)?/g;

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
function digitsToLatin(s: string) {
  return s.replace(/[٠-٩]/g, (d) => String(ARABIC_INDIC.indexOf(d)));
}

/** رموز «وقائعية» يجب ألا يضيفها التعديل: أرقام، روابط، إشارات ووسوم. (الكلمات اللاتينية مسموحة: الرسائل الإنجليزية تُعدَّل بلغتها.) */
export function factualTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const re of [URL_RE, MENTION_RE, NUMBER_RE]) {
    for (const m of text.matchAll(re)) out.add(digitsToLatin(m[0]).toLowerCase());
  }
  return out;
}

export function emojiSet(text: string): Set<string> {
  return new Set(text.match(EMOJI) ?? []);
}

export type CheckFailure =
  | { kind: 'new_token'; token: string; quote: string }
  | { kind: 'new_emoji'; emoji: string; quote: string }
  | { kind: 'too_much_changed'; ratio: number }
  | { kind: 'grew_too_much'; from: number; to: number }
  | { kind: 'unlocated_quote'; quote: string }
  | { kind: 'no_valid_edit' };

export type CheckReport = {
  failures: CheckFailure[];
  /** ألفاظ حادة ما زالت في الناتج؛ تحذير لا يمنع النتيجة. */
  residualHarsh: string[];
};

/** فحوص حتمية بعد تطبيق التعديلات. أي فشل هنا يعني أن التعديل غير آمن. */
export function runChecks(original: string, result: ApplyResult): CheckReport {
  const failures: CheckFailure[] = [];

  for (const r of result.rejected) {
    if (r.why === 'not_found') failures.push({ kind: 'unlocated_quote', quote: r.edit.quote });
  }

  for (const edit of result.applied) {
    const allowedTokens = factualTokens(edit.quote);
    for (const t of factualTokens(edit.replacement)) {
      if (!allowedTokens.has(t)) failures.push({ kind: 'new_token', token: t, quote: edit.quote });
    }
    const allowedEmoji = emojiSet(edit.quote);
    for (const e of emojiSet(edit.replacement)) {
      if (!allowedEmoji.has(e)) failures.push({ kind: 'new_emoji', emoji: e, quote: edit.quote });
    }
  }

  const ratio = original.length ? result.replacedChars / original.length : 0;
  // الرسالة القصيرة الحادة كلها قد تحتاج إعادة صياغة كاملة (والمدقق يحرس الموقف).
  // أما تعديل معظم رسالة طويلة فيعني إعادة كتابة لا تحريرًا موضعيًا.
  if (original.length > 160 && ratio > 0.85) failures.push({ kind: 'too_much_changed', ratio });

  if (result.improved.length > original.length * 1.5 + 40) {
    failures.push({ kind: 'grew_too_much', from: original.length, to: result.improved.length });
  }

  return { failures, residualHarsh: scanHarsh(result.improved) };
}

/** يحوّل الفشل إلى ملاحظة قصيرة تُرسل للنموذج عند إعادة المحاولة. */
export function describeFailures(failures: CheckFailure[]): string {
  const lines = failures.map((f) => {
    switch (f.kind) {
      case 'unlocated_quote':
        return `الاقتباس «${f.quote}» غير موجود حرفيًا في الرسالة؛ انسخ المقطع كما هو تمامًا.`;
      case 'new_token':
        return `البديل لمقطع «${f.quote}» أضاف «${f.token}» وهو غير موجود فيه؛ لا تضف أرقامًا أو روابط أو أسماء.`;
      case 'new_emoji':
        return `البديل لمقطع «${f.quote}» أضاف رمزًا تعبيريًا ${f.emoji}؛ لا تضف رموزًا.`;
      case 'too_much_changed':
        return 'غيّرت جزءًا كبيرًا من الرسالة؛ المطلوب تعديل أضيق المقاطع الحادة فقط وترك الباقي.';
      case 'grew_too_much':
        return 'الناتج أطول كثيرًا من الأصل؛ اختصر البدائل.';
      case 'no_valid_edit':
        return 'لم يصلح أي تعديل؛ أعد المحاولة بمقاطع منسوخة حرفيًا من الرسالة.';
    }
  });
  return lines.join('\n');
}

export { normalize };
