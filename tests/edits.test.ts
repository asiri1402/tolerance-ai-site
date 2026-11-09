import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEdits, findQuote } from '../lib/ai/edits';
import { runChecks } from '../lib/ai/checks';
import { scanHarsh } from '../lib/ai/lexicon';
import type { Edit } from '../lib/ai/types';

const edit = (quote: string, replacement: string): Edit => ({ quote, replacement, category: 'generalization', reason: 'x' });

test('النص خارج المقاطع المقتبسة يبقى حرفيًا، بما فيه فواصل الأسطر والتكرار', () => {
  const original = 'السلام عليكم!!\n\nأنت دائمًا تتأخر.\nشكرًا  لك 🌿';
  const r = applyEdits(original, [edit('أنت دائمًا تتأخر', 'تتأخر كثيرًا')]);
  assert.equal(r.improved, 'السلام عليكم!!\n\nتتأخر كثيرًا.\nشكرًا  لك 🌿');
});

test('اقتباس غير موجود يُرفض ولا يُطبَّق', () => {
  const r = applyEdits('رسالة عادية', [edit('عبارة غير موجودة', 'x')]);
  assert.equal(r.improved, 'رسالة عادية');
  assert.equal(r.rejected[0].why, 'not_found');
});

test('المطابقة تتسامح مع التشكيل والتطويل وصور الألف ثم تستبدل الأصل', () => {
  const original = 'أنتَ دائمًا تتأخّر عن المَواعيد';
  const found = findQuote(original, 'انت دائما تتاخر');
  assert.ok(found);
  const r = applyEdits(original, [edit('انت دائما تتاخر', 'تتأخر كثيرًا')]);
  assert.equal(r.improved, 'تتأخر كثيرًا عن المَواعيد');
});

test('تعديلان متداخلان: الثاني يُرفض', () => {
  const r = applyEdits('أنت غلطان تمامًا', [edit('أنت غلطان', 'أرى غير ذلك'), edit('غلطان تمامًا', 'مخطئ')]);
  assert.equal(r.applied.length, 1);
  assert.equal(r.rejected[0].why, 'overlap');
});

test('حذف مقطع لا يترك مسافة مزدوجة', () => {
  const r = applyEdits('أنت غبي وفكرتك خاطئة', [edit('غبي', '')]);
  assert.equal(r.improved, 'أنت وفكرتك خاطئة');
});

test('الفحص يرفض بديلًا يضيف رقمًا أو رمزًا أو رابطًا غير موجود', () => {
  const original = 'أنت غلطان في هذا';
  const r = applyEdits(original, [edit('أنت غلطان', 'أرى أن الخطأ بنسبة 100% 🙂 https://x.com')]);
  const kinds = runChecks(original, r).failures.map((f) => f.kind);
  assert.ok(kinds.includes('new_token'));
  assert.ok(kinds.includes('new_emoji'));
});

test('الفحص يسمح بإبقاء الرقم الموجود في المقطع نفسه', () => {
  const original = 'أنت غلطان 100%';
  const r = applyEdits(original, [edit('غلطان 100%', 'مخطئ 100%')]);
  assert.deepEqual(runChecks(original, r).failures, []);
});

test('إعادة كتابة معظم النص الطويل تُرفض كتحرير غير موضعي', () => {
  const original = 'هذه رسالة طويلة نسبيًا فيها كلام كثير عن الموضوع ولا يوجد فيها إلا القليل الحاد';
  const r = applyEdits(original, [edit(original, 'نص جديد كليًا يحل محل كل شيء')]);
  assert.ok(runChecks(original, r).failures.some((f) => f.kind === 'too_much_changed'));
});

test('القاموس يعمل مع الحروف العربية (\\b لا تعمل معها) ومع السوابق والتاء المربوطة', () => {
  assert.deepEqual(scanHarsh('يا غبي'), ['غبي']);
  assert.deepEqual(scanHarsh('الغبية تكلمت'), ['الغبية']);
  assert.deepEqual(scanHarsh('كلامك كله تفاهة'), ['تفاهة']);
});

test('القاموس لا يطابق جزءًا من كلمة أخرى ولا يعلّم النص السليم', () => {
  assert.deepEqual(scanHarsh('الغبار كثيف اليوم'), []);
  assert.deepEqual(scanHarsh('أنا ضد القرار لأنه يرفع التكلفة'), []);
  assert.deepEqual(scanHarsh('أنت دائمًا متعاون، شكرًا'), []);
});
