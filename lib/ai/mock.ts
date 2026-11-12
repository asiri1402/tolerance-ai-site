import { scanHarsh } from './lexicon';
import type { Editor, Restyler } from './model';

/**
 * بديل للتطوير والاختبار فقط (MOCK_AI=1). ليس مسار إنتاج.
 * يحذف الألفاظ الحادة المعروفة ويترك الباقي كما هو، فلا يخترع محتوى.
 */
export const mockEditor: Editor = async ({ text }) => {
  const hits = scanHarsh(text);
  if (!hits.length) {
    return { verdict: 'clean', no_rewrite_kind: 'none', stance: '', reader_view: '', edits: [] };
  }
  return {
    verdict: 'sharp',
    no_rewrite_kind: 'none',
    stance: '',
    reader_view: '',
    edits: hits.map((quote) => ({
      quote,
      replacement: '',
      category: 'insult' as const,
      reason: 'لفظ حاد معروف (وضع تطوير)'
    }))
  };
};

export const mockRestyler: Restyler = async ({ text }) => text;
