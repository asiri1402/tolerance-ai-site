import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, __resetRateLimit, checkRate, validateImage, validateText } from '../lib/ai/guard';

test('النص: فارغ ورموز فقط وأطول من الحد تُرفض', () => {
  assert.equal(validateText('   ').ok, false);
  assert.equal(validateText('!!!').ok, false);
  assert.equal(validateText(42).ok, false);
  const long = validateText('أ'.repeat(LIMITS.maxChars + 1));
  assert.equal(long.ok, false);
  assert.equal(validateText('مرحبا').ok, true);
});

test('الصورة: صيغة غير مدعومة وحجم كبير يُرفضان', () => {
  assert.equal(validateImage('data:image/gif;base64,AAAA').ok, false);
  assert.equal(validateImage('data:text/html;base64,AAAA').ok, false);
  assert.equal(validateImage('https://x.com/a.png').ok, false);
  const big = 'data:image/jpeg;base64,' + 'A'.repeat(Math.ceil((LIMITS.maxImageBytes * 4) / 3) + 8);
  assert.equal(validateImage(big).ok, false);
  assert.equal(validateImage('data:image/jpeg;base64,/9j/4AAQ').ok, true);
});

test('تحديد المعدل: يحجب بعد الحد في الدقيقة ويفتح بعدها', () => {
  __resetRateLimit();
  const t0 = Date.UTC(2026, 10, 9, 10, 0, 0);
  for (let i = 0; i < LIMITS.perMinute; i++) assert.equal(checkRate('1.1.1.1', t0 + i).ok, true);
  const blocked = checkRate('1.1.1.1', t0 + 1000);
  assert.equal(blocked.ok, false);
  assert.equal(checkRate('2.2.2.2', t0 + 1000).ok, true);
  assert.equal(checkRate('1.1.1.1', t0 + 61_000).ok, true);
});
