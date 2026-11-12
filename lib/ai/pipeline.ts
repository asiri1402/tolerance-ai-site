import { applyEdits } from './edits';
import { describeFailures, emojiSet, factualTokens, runChecks, type CheckFailure } from './checks';
import { scanHarsh } from './lexicon';
import type { Editor, Restyler, Verifier } from './model';
import {
  CATEGORY_LABELS,
  isToneEdit,
  type AppliedEdit,
  type EditorOutput,
  type ImproveResponse,
  type Severity
} from './types';

export type Deps = {
  editor: Editor;
  verifier?: Verifier | null;
  mode?: ImproveResponse['mode'];
};

const NO_REWRITE_NOTICE: Record<string, string> = {
  threat: 'الرسالة تتضمن تهديدًا، ولن نعيد صياغتها. إن كان الأمر جادًا فتحدّث مع شخص مسؤول (معلم أو مرشد أو ولي أمر).',
  self_harm: 'يبدو أن في كلامك ألمًا. لن نعدّل الرسالة، لكن نرجو أن تتحدث الآن مع شخص تثق به أو مرشد المدرسة.',
  hate: 'الرسالة تتضمن إساءة لفئة من الناس، ولن نعيد صياغتها. يمكنك التعبير عن اختلافك دون استهداف الناس بسبب دينهم أو أصلهم.'
};

const DEGRADED_NOTICE =
  'لم نستطع إنتاج صياغة بديلة موثوقة لهذه الرسالة. نعرض لك الملاحظات فقط، ونصّك الأصلي لم يتغير.';

const UNAVAILABLE_NOTICE =
  'خدمة التحسين غير متاحة الآن. هذا فحص أولي للكلمات الحادة فقط ولا يقيّم الرسالة كاملة.';

function normalizeInput(raw: string): string {
  return raw.replace(/\r\n?/g, '\n').trim();
}

function severityOf(v: EditorOutput['verdict']): Severity | null {
  return v === 'clean' || v === 'soften' || v === 'sharp' ? v : null;
}

function base(original: string, mode: ImproveResponse['mode']): ImproveResponse {
  return {
    status: 'ok',
    original,
    improved: original,
    severity: null,
    edits: [],
    stance: '',
    readerView: '',
    notice: '',
    verified: null,
    mode
  };
}

/** حين تتعذر الخدمة: فحص أولي بلا إعادة صياغة، ولا نقول أبدًا إن النص سليم. */
export function degradedScan(rawText: string, mode: ImproveResponse['mode'] = 'none'): ImproveResponse {
  const original = normalizeInput(rawText);
  const hits = scanHarsh(original);
  return {
    ...base(original, mode),
    status: 'degraded',
    notice: UNAVAILABLE_NOTICE,
    edits: hits.map((h) => ({
      quote: h,
      replacement: '',
      category: 'insult' as const,
      reason: 'لفظ حاد معروف',
      label: CATEGORY_LABELS.insult
    }))
  };
}

type Attempt =
  | { ok: true; out: EditorOutput }
  | { ok: false; error: unknown };

async function tryEditor(editor: Editor, text: string, feedback?: string): Promise<Attempt> {
  try {
    return { ok: true, out: await editor({ text, feedback }) };
  } catch (error) {
    // تشخيص بلا محتوى: اسم الخطأ ورمز الحالة، ورسالة قصيرة فقط لأخطاء الاتصال بالمزوّد (لا تحوي نص المستخدم).
    const e = error as { name?: string; statusCode?: number; message?: string };
    logEvent({
        event: 'editor_error',
        name: e?.name ?? 'unknown',
        statusCode: e?.statusCode ?? null,
        message: e?.statusCode ? String(e.message ?? '').slice(0, 200) : undefined
    });
    return { ok: false, error };
  }
}

/**
 * الخط الأنبوبي: النموذج يقترح تعديلات، والخادم يطبّقها على الأصل ويفحصها.
 * إعادة محاولة واحدة فقط (بملاحظات محددة)، ثم نعرض ملاحظات دون بديل.
 */
export async function improveText(rawText: string, deps: Deps): Promise<ImproveResponse> {
  const mode = deps.mode ?? 'ai';
  const original = normalizeInput(rawText);
  if (!original) return { ...base(original, mode), status: 'error', notice: 'أدخل نصًا أولًا.' };

  let feedback: string | undefined;
  let retried = false;

  for (;;) {
    const attempt = await tryEditor(deps.editor, original, feedback);
    if (!attempt.ok) {
      // فشل الخدمة أو مخرجات لا تطابق الـ schema: إعادة واحدة ثم فحص أولي.
      if (!retried && isSchemaError(attempt.error)) {
        retried = true;
        feedback = 'أعد الإجابة بالصيغة المطلوبة تمامًا.';
        continue;
      }
      return degradedScan(original, mode);
    }

    const out = attempt.out;

    if (out.verdict === 'no_rewrite') {
      return {
        ...base(original, mode),
        status: 'no_rewrite',
        notice: NO_REWRITE_NOTICE[out.no_rewrite_kind] ?? NO_REWRITE_NOTICE.threat
      };
    }

    // حكم «سليمة» يعني لا تعديل للنبرة؛ تبقى التصحيحات اللغوية فقط.
    const edits = out.verdict === 'clean' ? out.edits.filter((e) => !isToneEdit(e)) : out.edits;

    // لا تعديل للنبرة لكن فيه لفظ حاد معروف: نطلب من النموذج إعادة النظر مرة واحدة.
    if (!edits.some(isToneEdit) && !retried) {
      const hits = scanHarsh(original);
      if (hits.length) {
        retried = true;
        feedback = `وجدنا في الرسالة ألفاظًا قد تكون حادة: ${hits.join('، ')}. أعد النظر؛ وإن كانت اقتباسًا أو سياقًا سليمًا فأبقِها.`;
        continue;
      }
    }

    if (edits.length === 0) {
      return { ...base(original, mode), status: 'unchanged', severity: 'clean' };
    }

    const applied = applyEdits(original, edits);
    const report = runChecks(original, applied);
    const failures: CheckFailure[] = [...report.failures];
    if (applied.applied.length === 0) failures.push({ kind: 'no_valid_edit' });

    if (failures.length) {
      logEvent({ event: 'check_failed', kinds: [...new Set(failures.map((f) => f.kind))], retried });
      if (!retried) {
        retried = true;
        feedback = describeFailures(failures);
        continue;
      }
      return degradedFromEdits(original, applied.applied, mode);
    }

    // الفحص الدلالي (اختياري): هل بقي الموقف؟ هل أُضيف ما ليس في الأصل؟
    let verified: boolean | null = null;
    if (deps.verifier) {
      try {
        const v = await deps.verifier({ original, improved: applied.improved });
        verified = v.same_position && !v.added_claims;
        if (!verified) {
          logEvent({ event: 'verifier_rejected', same_position: v.same_position, added_claims: v.added_claims, retried });
          if (!retried) {
            retried = true;
            feedback = `المدقّق يرى مشكلة: ${v.note || 'تغيّر الموقف أو أُضيف ما ليس في الأصل'}. عدّل أضيق وأبقِ موقف المستخدم.`;
            continue;
          }
          return degradedFromEdits(original, applied.applied, mode);
        }
      } catch {
        verified = null; // تعذر المدقق: نكتفي بالفحوص الحتمية ونعلن أنه لم يُجرَ.
      }
    }

    return {
      status: 'ok',
      original,
      improved: applied.improved,
      severity: severityOf(out.verdict),
      edits: applied.applied.map(toApplied),
      stance: out.stance.trim(),
      readerView: out.edits.some(isToneEdit) ? out.reader_view.trim() : '',
      notice: report.residualHarsh.length
        ? 'ما زالت في النص كلمات قد تُقرأ حادة؛ راجعه قبل الإرسال.'
        : '',
      verified,
      mode
    };
  }
}

/** سجل تشخيص بلا محتوى (أنواع الفشل فقط). يُسكت في الاختبارات. */
function logEvent(e: Record<string, unknown>) {
  if (process.env.NODE_TEST_CONTEXT || process.env.QUIET_LOGS === '1') return;
  console.log(JSON.stringify({ app: 'tolerance', ...e }));
}

function toApplied(e: EditorOutput['edits'][number]): AppliedEdit {
  return { ...e, label: CATEGORY_LABELS[e.category] };
}

function degradedFromEdits(original: string, edits: EditorOutput['edits'], mode: ImproveResponse['mode']): ImproveResponse {
  return { ...base(original, mode), status: 'degraded', notice: DEGRADED_NOTICE, edits: edits.map(toApplied) };
}

function isSchemaError(error: unknown): boolean {
  const name = error instanceof Error ? error.name : '';
  return /NoObjectGenerated|TypeValidation|JSONParse|InvalidResponseData/i.test(name);
}

export type RestyleResult = { ok: true; text: string } | { ok: false; notice: string };

/** أسلوب بديل (رسمي/ودي/مختصر) عند الطلب، بفحوص صارمة: لا أرقام ولا روابط ولا رموز جديدة. */
export async function restyleText(
  rawText: string,
  style: 'formal' | 'friendly' | 'concise',
  restyler: Restyler,
  verifier?: Verifier | null
): Promise<RestyleResult> {
  const text = normalizeInput(rawText);
  if (!text) return { ok: false, notice: 'لا يوجد نص.' };
  try {
    const out = (await restyler({ text, style })).trim();
    if (!out) return { ok: false, notice: 'تعذر إنتاج هذا الأسلوب الآن.' };

    const allowed = factualTokens(text);
    for (const t of factualTokens(out)) {
      if (!allowed.has(t)) return { ok: false, notice: 'تعذر إنتاج هذا الأسلوب بأمان.' };
    }
    const allowedEmoji = emojiSet(text);
    for (const e of emojiSet(out)) {
      if (!allowedEmoji.has(e)) return { ok: false, notice: 'تعذر إنتاج هذا الأسلوب بأمان.' };
    }
    const minRatio = style === 'concise' ? 0.3 : 0.5;
    if (out.length > text.length * 1.6 + 40 || out.length < text.length * minRatio) {
      return { ok: false, notice: 'تعذر إنتاج هذا الأسلوب بأمان.' };
    }

    if (verifier) {
      try {
        const v = await verifier({ original: text, improved: out });
        if (!v.same_position || v.added_claims) return { ok: false, notice: 'تعذر إنتاج هذا الأسلوب بأمان.' };
      } catch {
        /* المدقق اختياري */
      }
    }
    return { ok: true, text: out };
  } catch {
    return { ok: false, notice: 'تعذر إنتاج هذا الأسلوب الآن.' };
  }
}
