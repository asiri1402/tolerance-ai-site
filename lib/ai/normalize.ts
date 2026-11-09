/**
 * تطبيع عربي يُستعمل للمطابقة فقط. لا يُستعمل أبدًا لإنتاج النص الذي يراه المستخدم.
 * يحتفظ بخريطة من كل حرف مُطبَّع إلى موضعه في النص الأصلي.
 */

const IGNORABLE = /[ً-ٰٟۖ-ۭـ​-‏‪-‮⁦-⁩﻿]/;

export function isIgnorable(ch: string): boolean {
  return IGNORABLE.test(ch);
}

function foldChar(ch: string): string {
  switch (ch) {
    case 'أ':
    case 'إ':
    case 'آ':
    case 'ٱ':
      return 'ا';
    case 'ى':
      return 'ي';
    case 'ک':
      return 'ك';
    case 'ی':
      return 'ي';
    default:
      return ch;
  }
}

export type NormalizedText = { norm: string; map: number[] };

export function normalizeWithMap(input: string): NormalizedText {
  let norm = '';
  const map: number[] = [];
  let lastWasSpace = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (isIgnorable(ch)) continue;
    if (/\s/.test(ch)) {
      if (lastWasSpace) continue;
      lastWasSpace = true;
      norm += ' ';
      map.push(i);
      continue;
    }
    lastWasSpace = false;
    norm += foldChar(ch);
    map.push(i);
  }
  return { norm, map };
}

export function normalize(input: string): string {
  return normalizeWithMap(input).norm;
}
