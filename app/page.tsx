'use client';

import { ChangeEvent, useMemo, useState } from 'react';

type ImproveResult = {
  original: string;
  improved: string;
  toneScoreBefore: number;
  toneScoreAfter: number;
  flags: string[];
  explanation: string;
  alternatives: { formal: string; friendly: string; concise: string };
  mode: 'ai' | 'demo';
};

const examples = [
  'واضح أنك ما فهمت الموضوع أصلًا.',
  'أنت دائمًا تتأخر وما يعتمد عليك.',
  'أنت غلطان 100% ولا عندك أي دليل.'
];

export default function Home() {
  const [tab, setTab] = useState<'text' | 'image'>('text');
  const [text, setText] = useState('');
  const [imageDataUrl, setImageDataUrl] = useState('');
  const [imageName, setImageName] = useState('');
  const [result, setResult] = useState<ImproveResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedVersion, setSelectedVersion] = useState<'improved' | 'formal' | 'friendly' | 'concise'>('improved');
  const [copied, setCopied] = useState(false);

  const selectedText = useMemo(() => {
    if (!result) return '';
    return selectedVersion === 'improved' ? result.improved : result.alternatives[selectedVersion];
  }, [result, selectedVersion]);

  async function improve() {
    setError('');
    setCopied(false);
    if (!text.trim() && !imageDataUrl) {
      setError('اكتب رسالة أو ارفع صورة أولًا.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/improve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, imageDataUrl })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'تعذر التحسين الآن.');
      setResult(data);
      setSelectedVersion('improved');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'حدث خطأ غير متوقع.');
    } finally {
      setLoading(false);
    }
  }

  function onImage(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('يرجى اختيار صورة فقط.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('حجم الصورة يجب ألا يتجاوز 5 ميجابايت.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setImageDataUrl(String(reader.result || ''));
      setImageName(file.name);
      setError('');
    };
    reader.readAsDataURL(file);
  }

  async function copyText() {
    if (!selectedText) return;
    await navigator.clipboard.writeText(selectedText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

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
                onChange={(e) => setText(e.target.value)}
                placeholder="اكتب الرسالة كما هي… حتى لو كانت حادة."
                maxLength={1400}
              />
              <div className="counter">{text.length} / 1400</div>
              <div className="examples-row">
                <span>جرّب مثالًا:</span>
                {examples.map((example, i) => (
                  <button key={i} onClick={() => setText(example)}>{i + 1}</button>
                ))}
              </div>
            </div>
          ) : (
            <div className="input-block">
              <label>ارفع صورة التهنئة أو المنشور أو لقطة الشاشة</label>
              <label className="dropzone">
                <input type="file" accept="image/*" onChange={onImage} />
                {imageDataUrl ? (
                  <div className="preview-wrap">
                    <img src={imageDataUrl} alt="معاينة الصورة المرفوعة" />
                    <strong>{imageName}</strong>
                    <span>اضغط لاختيار صورة أخرى</span>
                  </div>
                ) : (
                  <div className="upload-empty">
                    <div className="upload-icon">＋</div>
                    <strong>اختر صورة من جهازك</strong>
                    <span>PNG أو JPG - حتى 5MB</span>
                  </div>
                )}
              </label>
              <textarea
                className="image-note"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="اختياري: اكتب ما تريد التركيز عليه في الصورة…"
              />
            </div>
          )}

          {error && <div className="error-box">{error}</div>}

          <button className="primary" onClick={improve} disabled={loading}>
            {loading ? <><span className="loader" /> جارٍ التحسين…</> : <>✦ حسّنها قبل الإرسال</>}
          </button>
          <p className="privacy-note">لا نعرض حكمًا على الشخص؛ نحلل نبرة النص فقط.</p>
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
                  <span className="small-label">النتيجة</span>
                  <h2>صياغة أكثر وضوحًا واحترامًا</h2>
                </div>
                <span className={`mode-badge ${result.mode}`}>{result.mode === 'ai' ? 'ذكاء اصطناعي' : 'وضع تجريبي'}</span>
              </div>

              <div className="tone-grid">
                <ToneMeter label="قبل" value={result.toneScoreBefore} />
                <ToneMeter label="بعد" value={result.toneScoreAfter} />
              </div>

              <div className="flags">
                {result.flags.map((flag) => <span key={flag}>{flag}</span>)}
              </div>

              <div className="why-box">
                <strong>ماذا حسّنا؟</strong>
                <p>{result.explanation}</p>
              </div>

              <div className="versions" aria-label="أنماط الصياغة">
                <button className={selectedVersion === 'improved' ? 'active' : ''} onClick={() => setSelectedVersion('improved')}>متوازن</button>
                <button className={selectedVersion === 'formal' ? 'active' : ''} onClick={() => setSelectedVersion('formal')}>رسمي</button>
                <button className={selectedVersion === 'friendly' ? 'active' : ''} onClick={() => setSelectedVersion('friendly')}>ودي</button>
                <button className={selectedVersion === 'concise' ? 'active' : ''} onClick={() => setSelectedVersion('concise')}>مختصر</button>
              </div>

              <div className="improved-box">
                <p>{selectedText}</p>
                <button className="copy" onClick={copyText}>{copied ? 'تم النسخ ✓' : 'نسخ النص'}</button>
              </div>

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

function ToneMeter({ label, value }: { label: string; value: number }) {
  return (
    <div className="tone-meter">
      <div className="tone-top"><span>{label}</span><strong>{value}%</strong></div>
      <div className="bar"><i style={{ width: `${value}%` }} /></div>
      <small>وضوح واحترام النبرة</small>
    </div>
  );
}
