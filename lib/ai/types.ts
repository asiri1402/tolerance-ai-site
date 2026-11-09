import { z } from 'zod';

export const CATEGORIES = [
  'personal_attack',
  'generalization',
  'sarcasm',
  'absolute_claim',
  'dismissive',
  'insult',
  'language'
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  personal_attack: 'حكم على الشخص',
  generalization: 'تعميم',
  sarcasm: 'سخرية',
  absolute_claim: 'حكم قاطع',
  dismissive: 'إقصاء أو تقليل',
  insult: 'وصف جارح',
  language: 'تصحيح لغوي'
};

/** التعديلات التي تخص النبرة (كل ما عدا التصحيح اللغوي). */
export const isToneEdit = (e: { category: Category }) => e.category !== 'language';

/** ما يطلبه النموذج: تعديلات فقط، والخادم هو من يطبّقها على النص الأصلي. */
export const editSchema = z.object({
  quote: z.string(),
  replacement: z.string(),
  category: z.enum(CATEGORIES),
  reason: z.string()
});
export type Edit = z.infer<typeof editSchema>;

export const editorSchema = z.object({
  verdict: z.enum(['clean', 'soften', 'sharp', 'no_rewrite']),
  no_rewrite_kind: z.enum(['none', 'threat', 'self_harm', 'hate']),
  stance: z.string(),
  edits: z.array(editSchema).max(12)
});
export type EditorOutput = z.infer<typeof editorSchema>;

export const verifierSchema = z.object({
  same_position: z.boolean(),
  added_claims: z.boolean(),
  note: z.string()
});
export type VerifierOutput = z.infer<typeof verifierSchema>;

export const extractSchema = z.object({
  has_text: z.boolean(),
  text: z.string()
});
export type ExtractOutput = z.infer<typeof extractSchema>;

export type Severity = 'clean' | 'soften' | 'sharp';

/**
 * ok          : عُدّل النص وتجاوز الفحوص.
 * unchanged   : النص سليم، يُعاد كما هو حرفيًا.
 * no_rewrite  : تهديد أو إيذاء نفس أو كراهية؛ لا نُجمّل النص.
 * degraded    : لم نستطع إنتاج بديل موثوق؛ تُعرض ملاحظات فقط.
 * error       : خطأ في الطلب أو الخدمة.
 */
export type ImproveStatus = 'ok' | 'unchanged' | 'no_rewrite' | 'degraded' | 'error';

export type AppliedEdit = Edit & { label: string };

export type ImproveResponse = {
  status: ImproveStatus;
  original: string;
  improved: string;
  severity: Severity | null;
  edits: AppliedEdit[];
  /** رسالة موجّهة للمستخدم عند الحالات غير المعتادة. */
  notice: string;
  /** هل اجتاز الفحص الدلالي (null = لم يُجرَ). */
  verified: boolean | null;
  mode: 'ai' | 'mock' | 'none';
};
