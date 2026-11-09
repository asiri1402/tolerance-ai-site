import { test } from 'node:test';
import assert from 'node:assert/strict';
import { degradedScan, improveText, restyleText } from '../lib/ai/pipeline';
import type { Editor, Verifier } from '../lib/ai/model';
import type { EditorOutput } from '../lib/ai/types';

const clean: EditorOutput = { verdict: 'clean', no_rewrite_kind: 'none', stance: '', edits: [] };
const sharp = (quote: string, replacement: string): EditorOutput => ({
  verdict: 'sharp',
  no_rewrite_kind: 'none',
  stance: 'موقف',
  edits: [{ quote, replacement, category: 'generalization', reason: 'تعميم' }]
});

/** محرّر وهمي يعيد ردودًا مرتبة ويسجّل الملاحظات التي استلمها. */
function scripted(...replies: Array<EditorOutput | Error>) {
  const feedbacks: Array<string | undefined> = [];
  let i = 0;
  const editor: Editor = async ({ feedback }) => {
    feedbacks.push(feedback);
    const r = replies[Math.min(i++, replies.length - 1)];
    if (r instanceof Error) throw r;
    return r;
  };
  return { editor, feedbacks, calls: () => i };
}

test('النص السليم يعود كما هو حرفيًا وبلا تعديلات', async () => {
  const text = 'أنا ضد هذا القرار لأنه يرفع التكلفة،\nونحتاج بديلًا!!';
  const { editor } = scripted(clean);
  const res = await improveText(text, { editor });
  assert.equal(res.status, 'unchanged');
  assert.equal(res.improved, text);
  assert.deepEqual(res.edits, []);
});

test('تعديل صالح: يُطبَّق على الأصل ويبقى ما عداه كما هو', async () => {
  const { editor } = scripted(sharp('أنت دايمًا تتأخر', 'تتأخر كثيرًا'));
  const res = await improveText('أنت دايمًا تتأخر عن الاجتماعات.\nأرجو الالتزام.', { editor });
  assert.equal(res.status, 'ok');
  assert.equal(res.improved, 'تتأخر كثيرًا عن الاجتماعات.\nأرجو الالتزام.');
  assert.equal(res.edits[0].label, 'تعميم');
});

test('اقتباس مُختلَق: تُعاد المحاولة مرة واحدة بملاحظة محددة ثم تنجح', async () => {
  const { editor, feedbacks, calls } = scripted(
    sharp('عبارة ليست في الرسالة', 'x'),
    sharp('أنت دايمًا تتأخر', 'تتأخر كثيرًا')
  );
  const res = await improveText('أنت دايمًا تتأخر عن الاجتماعات.', { editor });
  assert.equal(res.status, 'ok');
  assert.equal(calls(), 2);
  assert.match(feedbacks[1] ?? '', /غير موجود حرفيًا/);
});

test('فشل متكرر: لا بديل، والأصل لم يتغير، والحالة degraded', async () => {
  const { editor, calls } = scripted(sharp('مختلق', 'x'));
  const original = 'أنت دايمًا تتأخر عن الاجتماعات.';
  const res = await improveText(original, { editor });
  assert.equal(res.status, 'degraded');
  assert.equal(res.improved, original);
  assert.equal(calls(), 2);
});

test('تهديد أو إيذاء نفس: لا إعادة صياغة', async () => {
  const { editor } = scripted({ verdict: 'no_rewrite', no_rewrite_kind: 'threat', stance: '', edits: [] });
  const res = await improveText('سأؤذيك', { editor });
  assert.equal(res.status, 'no_rewrite');
  assert.equal(res.improved, 'سأؤذيك');
  assert.ok(res.notice.length > 0);
});

test('تعذر النموذج: فحص أولي بلا إعادة صياغة، ولا يقول أبدًا إن النص سليم', async () => {
  const { editor } = scripted(new Error('boom'));
  const res = await improveText('كلامك كله تفاهة', { editor });
  assert.equal(res.status, 'degraded');
  assert.notEqual(res.status as string, 'unchanged');
  assert.equal(res.improved, 'كلامك كله تفاهة');
  assert.equal(res.edits[0].quote, 'تفاهة');
});

test('بلا نموذج مضبوط: نفس السلوك الصادق', () => {
  const res = degradedScan('يا غبي', 'none');
  assert.equal(res.status, 'degraded');
  assert.equal(res.mode, 'none');
  assert.equal(res.improved, 'يا غبي');
});

test('النموذج قال سليم لكن فيه لفظ حاد معروف: إعادة نظر واحدة فقط', async () => {
  const { editor, calls, feedbacks } = scripted(clean, sharp('تفاهة', 'كلام لا أراه مفيدًا'));
  const res = await improveText('كلامك كله تفاهة', { editor });
  assert.equal(calls(), 2);
  assert.match(feedbacks[1] ?? '', /تفاهة/);
  assert.equal(res.status, 'ok');
  assert.equal(res.improved, 'كلامك كله كلام لا أراه مفيدًا');
});

test('النموذج يصرّ على سليم بعد التنبيه: نثق به (قد يكون اقتباسًا)', async () => {
  const { editor, calls } = scripted(clean);
  const res = await improveText('قال لي: كلامك تفاهة، فاستغربت', { editor });
  assert.equal(calls(), 2);
  assert.equal(res.status, 'unchanged');
});

test('المدقق يرفض (تغيّر الموقف): إعادة ثم degraded', async () => {
  const { editor } = scripted(sharp('أنت دايمًا تتأخر', 'لا بأس'));
  const verifier: Verifier = async () => ({ same_position: false, added_claims: false, note: 'اختفى الاعتراض' });
  const res = await improveText('أنت دايمًا تتأخر عن الاجتماعات.', { editor, verifier });
  assert.equal(res.status, 'degraded');
  assert.equal(res.improved, 'أنت دايمًا تتأخر عن الاجتماعات.');
});

test('المدقق يقبل: verified = true', async () => {
  const { editor } = scripted(sharp('أنت دايمًا تتأخر', 'تتأخر كثيرًا'));
  const verifier: Verifier = async () => ({ same_position: true, added_claims: false, note: '' });
  const res = await improveText('أنت دايمًا تتأخر عن الاجتماعات.', { editor, verifier });
  assert.equal(res.status, 'ok');
  assert.equal(res.verified, true);
});

test('تعذر المدقق نفسه: لا يمنع النتيجة، ويُعلَن أنه لم يُجرَ', async () => {
  const { editor } = scripted(sharp('أنت دايمًا تتأخر', 'تتأخر كثيرًا'));
  const verifier: Verifier = async () => {
    throw new Error('down');
  };
  const res = await improveText('أنت دايمًا تتأخر عن الاجتماعات.', { editor, verifier });
  assert.equal(res.status, 'ok');
  assert.equal(res.verified, null);
});

test('بديل يضيف رقمًا جديدًا يُمنع حتى بعد الإعادة', async () => {
  const { editor } = scripted(sharp('أنت دايمًا تتأخر', 'تأخرت 3 مرات'));
  const res = await improveText('أنت دايمًا تتأخر عن الاجتماعات.', { editor });
  assert.equal(res.status, 'degraded');
});

test('الأسلوب البديل: يُرفض إن أضاف رقمًا أو رمزًا', async () => {
  const text = 'أرى أن القرار يرفع التكلفة ونحتاج بديلًا';
  const bad = await restyleText(text, 'friendly', async () => 'أرى أن القرار يرفع التكلفة 🌿 ونحتاج بديلًا');
  assert.equal(bad.ok, false);
  const bad2 = await restyleText(text, 'formal', async () => 'أرى أن القرار يرفع التكلفة بنسبة 20 ونحتاج بديلًا');
  assert.equal(bad2.ok, false);
  const good = await restyleText(text, 'formal', async () => 'أرى أن القرار يرفع التكلفة، ونحتاج إلى بديل');
  assert.equal(good.ok, true);
});
