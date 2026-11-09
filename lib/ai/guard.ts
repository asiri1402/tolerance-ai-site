export const LIMITS = {
  maxChars: 1400,
  /** حد الصورة بعد التصغير في المتصفح. دوال Vercel تقبل جسم طلب بنحو 4.5MB، فنبقى دونه. */
  maxImageBytes: 3_000_000,
  maxBodyBytes: 4_000_000,
  perMinute: 8,
  dailyCap: Number(process.env.DAILY_REQUEST_CAP ?? 3000)
};

export type GuardResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

export function validateText(raw: unknown): GuardResult<string> {
  if (typeof raw !== 'string') return { ok: false, status: 400, error: 'أدخل نصًا أولًا.' };
  const text = raw.trim();
  if (!text) return { ok: false, status: 400, error: 'أدخل نصًا أولًا.' };
  if (text.length > LIMITS.maxChars) {
    return { ok: false, status: 413, error: `النص أطول من ${LIMITS.maxChars} حرفًا.` };
  }
  // نص بلا أي حرف (رموز فقط) لا يحتاج تحسينًا.
  if (!/\p{L}/u.test(text)) return { ok: false, status: 400, error: 'اكتب رسالة نصية.' };
  return { ok: true, value: text };
}

const IMAGE_RE = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/;

export function validateImage(raw: unknown): GuardResult<string> {
  if (typeof raw !== 'string') return { ok: false, status: 400, error: 'ارفع صورة أولًا.' };
  const m = IMAGE_RE.exec(raw);
  if (!m) return { ok: false, status: 400, error: 'صيغة الصورة غير مدعومة (JPG أو PNG أو WebP).' };
  const bytes = Math.floor((m[2].length * 3) / 4);
  if (bytes > LIMITS.maxImageBytes) return { ok: false, status: 413, error: 'الصورة كبيرة بعد التصغير.' };
  return { ok: true, value: raw };
}

/**
 * تحديد معدل في الذاكرة: يعمل لكل نسخة تشغيل (instance) فقط، فهو حماية أولية.
 * للإنتاج الجاد فعّل Vercel Firewall rate limiting أو Upstash أمام هذا المسار.
 */
const hits = new Map<string, number[]>();
let dayKey = '';
let dayCount = 0;

export function checkRate(ip: string, now = Date.now()): GuardResult<true> {
  const today = new Date(now).toISOString().slice(0, 10);
  if (today !== dayKey) {
    dayKey = today;
    dayCount = 0;
  }
  if (dayCount >= LIMITS.dailyCap) {
    return { ok: false, status: 429, error: 'بلغت الخدمة حدّها اليومي. حاول غدًا.' };
  }

  const windowStart = now - 60_000;
  const recent = (hits.get(ip) ?? []).filter((t) => t > windowStart);
  if (recent.length >= LIMITS.perMinute) {
    hits.set(ip, recent);
    return { ok: false, status: 429, error: 'طلبات كثيرة في وقت قصير. انتظر دقيقة ثم حاول.' };
  }
  recent.push(now);
  hits.set(ip, recent);
  dayCount++;

  // تنظيف دوري كي لا تكبر الخريطة.
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (!v.some((t) => t > windowStart)) hits.delete(k);
  }
  return { ok: true, value: true };
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  return (fwd?.split(',')[0] ?? req.headers.get('x-real-ip') ?? 'unknown').trim();
}

/** للاختبارات فقط. */
export function __resetRateLimit() {
  hits.clear();
  dayKey = '';
  dayCount = 0;
}
