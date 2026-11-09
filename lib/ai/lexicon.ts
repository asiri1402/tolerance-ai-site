import { isIgnorable, normalizeWithMap } from './normalize';

/**
 * قائمة ألفاظ حادة معروفة. تُستعمل فقط في:
 *  - الفحص الأولي عند تعذر النموذج (بلا إعادة صياغة)،
 *  - تنبيه النموذج إن حكم بأن النص سليم وفيه لفظ حاد،
 *  - بيئة التطوير (mock).
 * ليست وسيلة لإعادة الصياغة. وجود اللفظ لا يعني بالضرورة إساءة (قد يكون اقتباسًا).
 */
const TERMS = [
  'غبي', 'غبيه', 'اغبي', 'حمار', 'كلب', 'جاهل', 'جاهله', 'تافه', 'تافهه', 'تفاهه',
  'سخيف', 'سخيفه', 'فاشل', 'فاشله', 'احمق', 'حقير', 'حقيره', 'وقح', 'وقحه',
  'متخلف', 'متخلفه', 'بليد', 'هبل', 'هبيل', 'معفن', 'حثاله', 'قذر', 'ساذج',
  'اسكت', 'اسكتي', 'اخرس', 'اخرسي', 'يلعن', 'زفت', 'خرا', 'زباله'
];

// السوابق الشائعة: ال، و، ف، ب، ك، ل، وال، بال، فال، كال، لل
const PREFIX = '(?:وال|بال|فال|كال|لل|ال|[وفبكل])?';
const BOUNDARY_BEFORE = '(?<![\\p{L}\\p{N}])';
const BOUNDARY_AFTER = '(?![\\p{L}\\p{N}])';

// ملاحظة: \b في JavaScript لا تعمل مع الحروف العربية، فنستعمل lookaround مع Unicode.
const PATTERN = new RegExp(`${BOUNDARY_BEFORE}${PREFIX}(?:${TERMS.join('|')})${BOUNDARY_AFTER}`, 'gu');

/** يعيد الألفاظ الحادة الموجودة كما وردت حرفيًا في النص (بلا تطبيع). */
export function scanHarsh(text: string): string[] {
  const { norm, map } = normalizeWithMap(text);
  const folded = norm.replace(/ة/g, 'ه'); // نفس الطول، فتبقى الخريطة صالحة
  const hits = new Set<string>();
  for (const m of folded.matchAll(PATTERN)) {
    const start = map[m.index!];
    let end = map[m.index! + m[0].length - 1] + 1;
    while (end < text.length && isIgnorable(text[end])) end++;
    hits.add(text.slice(start, end));
  }
  return [...hits];
}
