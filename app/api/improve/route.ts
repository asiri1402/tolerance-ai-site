import { LIMITS, checkRate, clientIp, validateImage, validateText } from '@/lib/ai/guard';
import {
  aiConfigured,
  gatewayEditor,
  gatewayExtractor,
  gatewayRestyler,
  gatewayVerifier
} from '@/lib/ai/model';
import { mockEditor, mockRestyler } from '@/lib/ai/mock';
import { degradedScan, improveText, restyleText } from '@/lib/ai/pipeline';

export const maxDuration = 60;

type Mode = 'ai' | 'mock' | 'none';

function currentMode(): Mode {
  if (process.env.MOCK_AI === '1' && process.env.NODE_ENV !== 'production') return 'mock';
  return aiConfigured() ? 'ai' : 'none';
}

function fail(status: number, notice: string) {
  return Response.json({ status: 'error', notice }, { status });
}

/** سجلات بلا محتوى: أطوال وحالات وأزمنة فقط. */
function log(event: Record<string, unknown>) {
  console.log(JSON.stringify({ app: 'tolerance', ...event }));
}

export async function POST(req: Request) {
  const started = Date.now();

  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > LIMITS.maxBodyBytes) return fail(413, 'الطلب كبير جدًا.');

  const rate = checkRate(clientIp(req));
  if (!rate.ok) return fail(rate.status, rate.error);

  let body: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (raw.length > LIMITS.maxBodyBytes) return fail(413, 'الطلب كبير جدًا.');
    body = JSON.parse(raw);
    if (typeof body !== 'object' || body === null) throw new Error('bad');
  } catch {
    return fail(400, 'طلب غير صالح.');
  }

  const mode = currentMode();
  const action = typeof body.action === 'string' ? body.action : 'improve';

  try {
    // ── استخراج النص من صورة (الخطوة الأولى؛ يراجعه المستخدم قبل التحسين) ──
    if (action === 'extract') {
      const img = validateImage(body.imageDataUrl);
      if (!img.ok) return fail(img.status, img.error);
      if (mode !== 'ai') return fail(503, 'قراءة الصور تحتاج تفعيل نموذج الذكاء الاصطناعي.');

      const out = await gatewayExtractor({ imageDataUrl: img.value });
      log({ action, status: out.has_text ? 'ok' : 'no_text', chars: out.text.length, ms: Date.now() - started });
      if (!out.has_text || !out.text.trim()) {
        return Response.json({ status: 'no_text', notice: 'لم نجد نصًا مقروءًا في الصورة.' });
      }
      return Response.json({ status: 'ok', text: out.text.slice(0, LIMITS.maxChars) });
    }

    const text = validateText(body.text);
    if (!text.ok) return fail(text.status, text.error);

    // ── أسلوب بديل عند الطلب ──
    if (action === 'restyle') {
      const style = body.style;
      if (style !== 'formal' && style !== 'friendly' && style !== 'concise') return fail(400, 'أسلوب غير معروف.');
      if (mode === 'none') return fail(503, 'الخدمة غير متاحة الآن.');
      const restyler = mode === 'mock' ? mockRestyler : gatewayRestyler;
      const result = await restyleText(text.value, style, restyler, mode === 'ai' ? gatewayVerifier() : null);
      log({ action, style, ok: result.ok, ms: Date.now() - started });
      return Response.json(result);
    }

    if (action !== 'improve') return fail(400, 'إجراء غير معروف.');

    // ── التحسين ──
    if (mode === 'none') {
      const res = degradedScan(text.value, 'none');
      log({ action, status: res.status, mode, chars: text.value.length, ms: Date.now() - started });
      return Response.json(res);
    }

    const res = await improveText(text.value, {
      editor: mode === 'mock' ? mockEditor : gatewayEditor,
      verifier: mode === 'ai' ? gatewayVerifier() : null,
      mode
    });
    log({
      action,
      status: res.status,
      severity: res.severity,
      edits: res.edits.length,
      verified: res.verified,
      mode,
      chars: text.value.length,
      ms: Date.now() - started
    });
    return Response.json(res);
  } catch (error) {
    // لا نسجّل الخطأ كاملًا: قد يحمل جزءًا من الطلب.
    log({
      action,
      status: 'exception',
      name: error instanceof Error ? error.name : 'unknown',
      ms: Date.now() - started
    });
    if (action === 'extract') return fail(503, 'تعذرت قراءة الصورة الآن. جرّب لاحقًا أو اكتب النص بنفسك.');
    return fail(503, 'تعذر التحسين الآن. حاول بعد قليل.');
  }
}
