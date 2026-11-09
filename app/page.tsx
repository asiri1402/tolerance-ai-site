'use client';

import { ChangeEvent, useMemo, useState } from 'react';

type AppliedEdit = { quote: string; replacement: string; category: string; reason: string; label: string };

type ImproveResult = {
  status: 'ok' | 'unchanged' | 'no_rewrite' | 'degraded' | 'error';
  original: string;
  improved: string;
  severity: 'clean' | 'soften' | 'sharp' | null;
  edits: AppliedEdit[];
  notice: string;
  verified: boolean | null;
  mode: 'ai' | 'mock' | 'none';
};

type Style = 'formal' | 'friendly' | 'concise';
type Version = 'improved' | Style;

const examples = [
  'واضح أنك ما فهمت الموضوع أصلًا.',
  'أنت دائمًا تتأخر وما يعتمد عليك.',
  'أنا ضد هذا القرار لأنه يرفع التكلفة، ونحتاج بديلًا.'
];

const MAX_DIM = 1568;
const MAX_IMAGE_BYTES = 3_000_000;

/** يصغّر الصورة ويعيد ترميزها JPEG؛ إعادة الترميز تزيل بيانات EXIF (الموقع وغيره). */
async function prepareImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('تعذرت معالجة الصورة.');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  for (const q of [0.85, 0.7, 0.55]) {
    const url = canvas.toDataURL('image/jpeg', q);
    if ((url.length * 3) / 4 <= MAX_IMAGE_BYTES) return url;
  }
  throw new Error('الصورة كبيرة جدًا حتى بعد التصغير.');
}

async function post(payload: Record<string, unknown>) {
  const res = await fetch('/api/improve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.notice || data.error || 'تعذر تنفيذ الطلب الآن.');
  return data;
}

export default function Home() {
  const [tab, setTab] = useState<'text' | 'image'>('text');
  const [text, setText] = useState('');
  const [imagePreview, setImagePreview] = useState('');
  const [imageName, setImageName] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [fromImage, setFromImage] = useState(false);
  const [result, setResult] = useState<ImproveResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedVersion, setSelectedVersion] = useState<Version>('improved');
  const [variants, setVariants] = useState<Partial<Record<Style, string>>>({});
  const [variantLoading, setVariantLoading] = useState(false);
  const [variantError, setVariantError] = useState('');
  const [copied, setCopied] = useState(false);

  const selectedText = useMemo(() => {
    if (!result) return '';
    if (selectedVersion === 'improved') return result.improved;
    return variants[selectedVersion] ?? '';
  }, [result, selectedVersion, variants]);

  async function improve() {
    setError('');
    setCopied(false);
    if (!text.trim()) {
      setError(tab === 'image' ? 'ارفع صورة أولًا ليُقرأ نصها.' : 'اكتب رسالة أولًا.');
      return;
    }
    setLoading(true);
    try {
      const data = (await post({ action: 'improve', text })) as ImproveResult;
      setResult(data);
      setSelectedVersion('improved');
      setVariants({});
      setVariantError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'حدث خطأ غير متوقع.');
    } finally {
      setLoading(false);
    }
  }

  async function onImage(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('يرجى اختيار صورة فقط.');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setError('حجم الصورة كبير جدًا.');
      return;
    }
    setError('');
    setExtracting(true);
    try {
      const dataUrl = await prepareImage(file);
      setImagePreview(dataUrl);
      setImageName(file.name);
      const data = await post({ action: 'extract', imageDataUrl: dataUrl });
      if (data.status === 'no_text') {
        setError(data.notice);
        return;
      }
      setText(String(data.text || ''));
      setFromImage(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذرت قراءة الصورة.');
    } finally {
      setExtracting(false);
    }
  }

  async function chooseVersion(v: Version) {
    setSelectedVersion(v);
    setCopied(false);
    setVariantError('');
    if (v === 'improved' || !result || variants[v]) return;
    setVariantLoading(true);
    try {
      const data = await post({ action: 'restyle', text: result.improved, style: v });
      if (data.ok) setVariants((prev) => ({ ...prev, [v]: data.text }));
      else {
        setVariantError(data.notice || 'تعذر إنتاج هذا الأسلوب.');
        setSelectedVersion('improved');
      }
    } catch (err) {
      setVariantError(err instanceof Error ? err.message : 'تعذر إنتاج هذا الأسلوب.');
      setSelectedVersion('improved');
    } finally {
      setVariantLoading(false);
    }
  }

  async function copyText() {
    if (!selectedText) return;
    await navigator.clipboard.writeText(selectedText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  const headline =
    result?.status === 'ok'
      ? 'صياغة أكثر وضوحًا واحترامًا'
      : result?.status === 'unchanged'
        ? 'رسالتك واضحة ومحترمة كما هي'
        : result?.status === 'no_rewrite'
          ? 'لن نعدّل هذه الرسالة'
          : 'لم نستطع تحسين الرسالة';

  const modeLabel = result?.mode === 'ai' ? 'ذكاء اصطناعي' : result?.mode === 'mock' ? 'وضع تطوير' : 'فحص أولي';
  const severityLabel = result?.severity === 'sharp' ? 'حادة' : result?.severity === 'soften' ? 'تحتاج تلطيفًا' : result?.severity === 'clean' ? 'سليمة' : '';

  return (
    <main className="page-shell">
      <div className="pattern pattern-a" aria-hidden="true" />
      <div className="pattern pattern-b" aria-hidden="true" />

      <header className="brandbar wrap">
        <img className="brand-logo" src="/assets/tuwaiq-moe.png" alt="أكاديمية طويق ووزارة التعليم" />
        <span className="event-tag">اليوم الدولي للتسامح</span>
      </header>

      <section className="hero wrap">
        <div className="eyebrow"><span className="spark">✦</span> تجربة ذكية لتحسين التواصل</div>
        <h1>لا تغيّر رأيك…<br /><span>حسّن طريقة التعبير عنه.</span></h1>
        <p className="hero-copy">اكتب رسالتك أو ارفع صورة لمنشور قبل إرساله. نساعدك على اكتشاف ما قد يُفهم بشكل سلبي وصياغته بوضوح واحترام، دون تغيير رأيك.</p>
      </section>

      <section className="workspace wrap">
        <div className="composer card">
          <div className="tabs" role="tablist" aria-label="نوع الإدخال">
            <button className={tab === 'text' ? 'active' : ''} onClick={() => setTab('text')}>نص أو رسالة</button>
            <button className={tab === 'image' ? 'active' : ''} onClick={() => setTab('image')}>صورة أو بوست</button>
          </div>

          {tab === 'text' ? (
            <div className="input-block">
              <label htmlFor="message">ما الذي تريد إرساله؟</label>
              <textarea
                id="message"
                value={text}
                onChange={(e) => { setText(e.target.value); setFromImage(false); }}
                placeholder="اكتب الرسالة كما هي… حتى لو كانت حادة."
                maxLength={1400}
              />
              <div className="counter">{text.length} / 1400</div>
              <div className="examples-row">
                <span>جرّب مثالًا:</span>
                {examples.map((example, i) => (
                  <button key={i} onClick={() => { setText(example); setFromImage(false); }}>{i + 1}</button>
                ))}
              </div>
            </div>
          ) : (
            <div className="input-block">
              <label>ارفع لقطة شاشة لرسالة أو منشور</label>
              <label className="dropzone">
                <input type="file" accept="image/*" onChange={onImage} disabled={extracting} />
                {imagePreview ? (
                  <div className="preview-wrap">
                    <img src={imagePreview} alt="معاينة الصورة المرفوعة" />
                    <strong>{imageName}</strong>
                    <span>{extracting ? 'جارٍ قراءة النص…' : 'اضغط لاختيار صورة أخرى'}</span>
                  </div>
                ) : (
                  <div className="upload-empty">
                    <div className="upload-icon">＋</div>
                    <strong>{extracting ? 'جارٍ قراءة النص…' : 'اختر صورة من جهازك'}</strong>
                    <span>PNG أو JPG أو WebP</span>
                  </div>
                )}
              </label>
              {fromImage && (
                <div className="extract-note">
                  <strong>النص المقروء من الصورة</strong>
                  <span>راجعه وصحّح أي خطأ في القراءة قبل التحسين. قد تحتوي الصورة على أسماء أشخاص، فاحذف ما لا تريد معالجته.</span>
                </div>
              )}
              <textarea
                className="image-note"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="سيظهر هنا النص المقروء من الصورة ليُراجَع…"
                maxLength={1400}
              />
            </div>
          )}

          {error && <div className="error-box" role="alert">{error}</div>}

          <button className="primary" onClick={improve} disabled={loading || extracting}>
            {loading ? <><span className="loader" /> جارٍ التحسين…</> : <>✦ حسّنها قبل الإرسال</>}
          </button>
          <p className="privacy-note">نحلل نبرة النص فقط ولا نحكم على الشخص. يُرسل النص لمعالجة آلية ولا نخزّنه في الموقع.</p>
        </div>

        <div className={`result card ${result ? 'has-result' : ''}`}>
          {!result ? (
            <div className="empty-result">
              <div className="result-orb">✦</div>
              <h2>النتيجة ستظهر هنا</h2>
              <p>سنوضح ما الذي قد يُفهم بشكل سلبي، ثم نقترح صياغة تحافظ على رأيك وتقلل سوء الفهم.</p>
              <div className="mini-flow"><span>رسالتك</span><b>←</b><span>تحليل النبرة</span><b>←</b><span>صياغة أفضل</span></div>
            </div>
          ) : (
            <div className="result-content">
              <div className="result-head">
                <div>
                  <span className="small-label">النتيجة{severityLabel ? ` · ${severityLabel}` : ''}</span>
                  <h2>{headline}</h2>
                </div>
                <span className={`mode-badge ${result.mode === 'ai' ? 'ai' : 'demo'}`}>{modeLabel}</span>
              </div>

              {result.notice && <div className="notice-box" role="status">{result.notice}</div>}

              {result.edits.length > 0 && (
                <div className="edit-list">
                  <strong>{result.status === 'ok' ? 'ماذا حسّنا؟' : 'ملاحظات'}</strong>
                  {result.edits.map((edit, i) => (
                    <div className="edit-item" key={`${edit.quote}-${i}`}>
                      <span className="edit-tag">{edit.label}</span>
                      <p className="edit-change">
                        <del>{edit.quote}</del>
                        {edit.replacement && <><b aria-hidden="true"> ← </b><ins>{edit.replacement}</ins></>}
                      </p>
                      <small>{edit.reason}</small>
                    </div>
                  ))}
                </div>
              )}

              {result.status === 'ok' && (
                <>
                  {result.verified && <p className="verified-line">✓ تحققنا أن موقفك بقي كما هو دون إضافات.</p>}

                  <div className="versions" aria-label="أنماط الصياغة">
                    <button className={selectedVersion === 'improved' ? 'active' : ''} onClick={() => chooseVersion('improved')}>متوازن</button>
                    <button className={selectedVersion === 'formal' ? 'active' : ''} onClick={() => chooseVersion('formal')} disabled={variantLoading}>رسمي</button>
                    <button className={selectedVersion === 'friendly' ? 'active' : ''} onClick={() => chooseVersion('friendly')} disabled={variantLoading}>ودي</button>
                    <button className={selectedVersion === 'concise' ? 'active' : ''} onClick={() => chooseVersion('concise')} disabled={variantLoading}>مختصر</button>
                  </div>
                  {variantError && <div className="error-box" role="alert">{variantError}</div>}

                  <div className="improved-box">
                    <p>{variantLoading ? 'جارٍ إعداد هذا الأسلوب…' : selectedText}</p>
                    <button className="copy" onClick={copyText} disabled={variantLoading}>{copied ? 'تم النسخ ✓' : 'نسخ النص'}</button>
                  </div>
                </>
              )}

              {result.status === 'unchanged' && (
                <div className="improved-box">
                  <p>{result.original}</p>
                  <button className="copy" onClick={() => { navigator.clipboard.writeText(result.original); setCopied(true); setTimeout(() => setCopied(false), 1600); }}>{copied ? 'تم النسخ ✓' : 'نسخ النص'}</button>
                </div>
              )}

              <p className="result-footer">الاختلاف طبيعي. المهم أن تصل الفكرة دون أن تتحول الكلمات إلى حاجز.</p>
            </div>
          )}
        </div>
      </section>

      <section className="principles wrap">
        <div><b>01</b><strong>نحافظ على رأيك</strong><span>لا نغيّر موقفك أو نفرض عليك صياغة بعينها.</span></div>
        <div><b>02</b><strong>نفصل الفكرة عن الشخص</strong><span>نقلل التعميم والاتهام والتجريح دون تمييع المعنى.</span></div>
        <div><b>03</b><strong>نقلل سوء الفهم</strong><span>صياغة أوضح تساعد على استمرار الحوار بدل قطعه.</span></div>
      </section>

      <footer className="wrap footer">مبادرة تقنية لنشر ثقافة التسامح في التواصل الرقمي</footer>
    </main>
  );
}
