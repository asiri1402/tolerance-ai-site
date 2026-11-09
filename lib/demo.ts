export type ImproveResult = {
  original: string;
  improved: string;
  toneScoreBefore: number;
  toneScoreAfter: number;
  flags: string[];
  explanation: string;
  alternatives: {
    formal: string;
    friendly: string;
    concise: string;
  };
  mode: 'ai' | 'demo';
};

const replacements: Array<[RegExp, string, string]> = [
  [/واضح أنك ما فهمت(?: الموضوع)?(?: أصلًا| اصلا)?/gi, 'أعتقد أن فهمنا للموضوع مختلف', 'تقليل من فهم الطرف الآخر'],
  [/فكرتك سيئة(?: وما لها أي فايدة)?/gi, 'أرى أن الفكرة تحتاج بعض التطوير', 'حكم قاطع على الفكرة'],
  [/ما يعتمد عليك/gi, 'أتمنى الالتزام بما تم الاتفاق عليه', 'حكم على الشخص بدل السلوك'],
  [/أنت دائمًا/gi, 'في بعض المرات', 'تعميم'],
  [/أنت دايمًا/gi, 'في بعض المرات', 'تعميم'],
  [/أنت غلطان(?: 100%| ١٠٠٪)?/gi, 'أنا أرى الموضوع بشكل مختلف', 'حكم قطعي'],
  [/ما تعرف تتكلم باحترام/gi, 'أتمنى أن نكمل الحوار بأسلوب هادئ ومحترم', 'صياغة مواجهة'],
  [/لا تدخل في النقاش/gi, 'خلنا نكمل النقاش مع احترام اختلافنا', 'إقصاء الطرف الآخر'],
  [/ما تفهم فيه/gi, 'قد تكون لدينا معلومات مختلفة عنه', 'تقليل من المعرفة'],
  [/ردك مستفز جدًا/gi, 'شعرت أن أسلوب الرد كان حادًا', 'وصف هجومي مباشر'],
  [/ما يستاهل حتى أرد عليك/gi, 'وأفضل أن نكمل الحوار بهدوء', 'قطع الحوار بطريقة مستفزة'],
  [/تخربون العمل/gi, 'حدثت بعض الأخطاء في العمل', 'لوم جماعي'],
  [/رأيك غريب جدًا/gi, 'رأيك مختلف عن وجهة نظري', 'وصف قد يُفهم كسخرية']
];

function normalizePunctuation(text: string) {
  return text
    .replace(/!{2,}/g, '!')
    .replace(/\?{2,}/g, '؟')
    .replace(/\s+/g, ' ')
    .trim();
}

export function demoImprove(input: string): ImproveResult {
  const original = normalizePunctuation(input || '');
  let improved = original;
  const flags: string[] = [];

  for (const [pattern, replacement, flag] of replacements) {
    if (pattern.test(improved)) {
      pattern.lastIndex = 0;
      improved = improved.replace(pattern, replacement);
      if (!flags.includes(flag)) flags.push(flag);
    }
    pattern.lastIndex = 0;
  }

  if (/\b(غبي|فاشل|سخيف|تافه)\b/gi.test(improved)) {
    improved = improved.replace(/\b(غبي|فاشل|سخيف|تافه)\b/gi, 'غير مناسب');
    flags.push('وصف شخصي جارح');
  }

  improved = normalizePunctuation(improved);
  if (!flags.length) {
    return {
      original,
      improved: original,
      toneScoreBefore: 96,
      toneScoreAfter: 96,
      flags: [],
      explanation: 'النص واضح ومحترم كما هو؛ لا يحتاج إلى تعديل.',
      alternatives: { formal: original, friendly: original, concise: original },
      mode: 'demo'
    };
  }

  const before = Math.max(20, 78 - flags.length * 16);
  const after = Math.min(96, Math.max(86, before + 28));

  return {
    original,
    improved,
    toneScoreBefore: before,
    toneScoreAfter: after,
    flags,
    explanation: 'حافظنا على الفكرة الأساسية، وقللنا التعميم أو الحكم الشخصي، وحولنا التركيز إلى السلوك أو الفكرة نفسها.',
    alternatives: {
      formal: `أقدّر وجهة نظرك، وأرى أن من الأفضل تناول الموضوع بصورة أكثر هدوءًا ووضوحًا. ${improved}`,
      friendly: `ممكن نختلف، وهذا طبيعي 🌿 ${improved}`,
      concise: improved.length > 120 ? `${improved.slice(0, 117)}…` : improved
    },
    mode: 'demo'
  };
}
