/**
 * تشغيل مجموعة التقييم.
 *   npm run eval -- --baseline        المنطق القديم (بلا نموذج)
 *   npm run eval -- --mock            الخط الأنبوبي الجديد مع محرّر وهمي (يختبر الفحوص فقط)
 *   npm run eval                      الخط الأنبوبي الجديد مع النموذج (يحتاج AI_MODEL وصلاحية AI Gateway)
 * خيارات: --runs N (تكرار كل حالة)، --filter group، --verify (تفعيل المدقق إن ضُبط AI_VERIFIER_MODEL)
 *
 * المقاييس هنا حتمية فقط (بقاء النص السليم حرفيًا، كشف الحاد، إزالة العبارات الجارحة، بقاء ما يعبّر عن الموقف).
 * الحكم على «بقاء الموقف» و«جودة الشرح» يحتاج مقيّمين بشريين: انظر evals/README.md.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { improveText } from '../lib/ai/pipeline';
import { mockEditor } from '../lib/ai/mock';
import { scanHarsh } from '../lib/ai/lexicon';
import { isToneEdit } from '../lib/ai/types';
import { demoImprove } from './baseline/demo-old';

type Case = {
  id: string;
  group: string;
  dialect: string;
  text: string;
  expect: 'clean' | 'change' | 'no_rewrite' | 'language';
  must_remove?: string[];
  must_keep?: string[];
};

type Outcome = {
  status: string;
  improved: string;
  /** عُدّلت النبرة (تعديل غير لغوي واحد على الأقل). */
  flagged: boolean;
  toneEdits: number;
  unchangedExact: boolean;
  ms: number;
};

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const opt = (n: string) => {
  const i = args.indexOf(n);
  return i === -1 ? undefined : args[i + 1];
};

const endpoint = opt('--endpoint'); // اختبار موقع منشور عبر HTTP (يخضع لحد المعدل: نبطئ الطلبات)
const label = opt('--label') ?? '';
const mode = endpoint ? 'remote' : flag('--baseline') ? 'baseline' : flag('--mock') ? 'mock' : 'ai';
const runs = Number(opt('--runs') ?? 1);
const only = opt('--filter');
const cases: Case[] = readFileSync(join(import.meta.dirname, 'cases.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l))
  .filter((c: Case) => !only || c.group === only);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runRemote(c: Case): Promise<Outcome> {
  const t0 = Date.now();
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(endpoint!, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'improve', text: c.text })
    });
    if (res.status === 429) {
      await sleep(35_000);
      continue;
    }
    const d = (await res.json()) as { status: string; improved?: string; edits?: Array<{ category: string }> };
    const improved = d.improved ?? '';
    const toneEdits = (d.edits ?? []).filter((e) => e.category !== 'language').length;
    return {
      status: d.status,
      improved,
      flagged: d.status === 'ok' && toneEdits > 0,
      toneEdits,
      unchangedExact: d.status === 'unchanged' && improved === c.text.replace(/\r\n?/g, '\n').trim(),
      ms: Date.now() - t0
    };
  }
  throw new Error('429 متكرر');
}

async function runOne(c: Case): Promise<Outcome> {
  const t0 = Date.now();
  if (mode === 'remote') return runRemote(c);
  if (mode === 'baseline') {
    const r = demoImprove(c.text);
    return {
      status: r.flags.length ? 'ok' : 'unchanged',
      improved: r.improved,
      flagged: r.flags.length > 0,
      toneEdits: r.flags.length,
      unchangedExact: !r.flags.length && r.improved === c.text,
      ms: Date.now() - t0
    };
  }
  let editor = mockEditor;
  let verifier = null;
  if (mode === 'ai') {
    if (!process.env.AI_MODEL) throw new Error('AI_MODEL غير مضبوط. ضعه في .env.local أو استعمل --mock / --baseline.');
    const m = await import('../lib/ai/model');
    editor = m.gatewayEditor;
    verifier = flag('--verify') ? m.gatewayVerifier() : null;
  }
  const r = await improveText(c.text, { editor, verifier, mode: mode === 'ai' ? 'ai' : 'mock' });
  const toneEdits = r.edits.filter(isToneEdit).length;
  return {
    status: r.status,
    improved: r.improved,
    flagged: r.status === 'ok' && toneEdits > 0,
    toneEdits,
    unchangedExact: r.status === 'unchanged' && r.improved === c.text.replace(/\r\n?/g, '\n').trim(),
    ms: Date.now() - t0
  };
}

function judge(c: Case, o: Outcome) {
  const okOrSame = o.status === 'ok' || o.status === 'unchanged';
  // سليمة: لا تعديل على النبرة (التصحيح اللغوي مسموح ويُقاس منفصلًا في clean_returned_verbatim).
  if (c.expect === 'clean') return { pass: okOrSame && o.toneEdits === 0, kept: true, removed: true };
  if (c.expect === 'no_rewrite') return { pass: o.status === 'no_rewrite', kept: true, removed: true };
  const removed = (c.must_remove ?? []).every((s) => !o.improved.includes(s));
  const kept = (c.must_keep ?? []).every((s) => o.improved.includes(s));
  if (c.expect === 'language') return { pass: okOrSame && o.toneEdits === 0 && removed && kept, kept, removed };
  return { pass: o.flagged && removed && kept, kept, removed };
}

async function pool<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(0)}%` : '—');
const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0;
};

const jobs = cases.flatMap((c) => Array.from({ length: runs }, (_, run) => ({ c, run })));
const results = await pool(jobs, mode === 'ai' ? 4 : mode === 'remote' ? 1 : 8, async ({ c, run }) => {
  try {
    if (mode === 'remote') await sleep(8_600); // ≈7 طلبات في الدقيقة، دون حد المعدل (8)
    const o = await runOne(c);
    return { c, run, o, j: judge(c, o), error: '' };
  } catch (e) {
    return { c, run, o: null, j: { pass: false, kept: false, removed: false }, error: e instanceof Error ? e.message : String(e) };
  }
});

if (results.some((r) => r.error.startsWith('AI_MODEL'))) {
  console.error(results.find((r) => r.error)!.error);
  process.exit(2);
}

const by = (pred: (c: Case) => boolean) => results.filter((r) => pred(r.c));
const clean = by((c) => c.expect === 'clean');
const change = by((c) => c.expect === 'change');
const nr = by((c) => c.expect === 'no_rewrite');
const lang = by((c) => c.expect === 'language');
const flagged = change.filter((r) => r.o?.flagged);
const lat = results.flatMap((r) => (r.o ? [r.o.ms] : []));

const summary = {
  mode,
  cases: cases.length,
  runs,
  clean_no_tone_change: pct(clean.filter((r) => r.j.pass).length, clean.length),
  clean_returned_verbatim: pct(clean.filter((r) => r.o?.unchangedExact).length, clean.length),
  language_fixed_correctly: pct(lang.filter((r) => r.j.pass).length, lang.length),
  sharp_flagged: pct(flagged.length, change.length),
  sharp_missed_as_clean: pct(change.filter((r) => r.o && !r.o.flagged && r.o.status === 'unchanged').length, change.length),
  sharp_full_pass: pct(change.filter((r) => r.j.pass).length, change.length),
  stance_markers_kept_among_flagged: pct(flagged.filter((r) => r.j.kept).length, flagged.length),
  harsh_terms_removed_among_flagged: pct(flagged.filter((r) => r.j.removed).length, flagged.length),
  no_rewrite_pass: pct(nr.filter((r) => r.j.pass).length, nr.length),
  degraded_or_error: pct(results.filter((r) => !r.o || r.o.status === 'degraded' || r.o.status === 'error').length, results.length),
  latency_ms_p50: quantile(lat, 0.5),
  latency_ms_p95: quantile(lat, 0.95)
};

const groups = [...new Set(cases.map((c) => c.group))];
console.log(`\n== ${mode} · ${cases.length} حالة × ${runs} ==`);
for (const g of groups) {
  const rs = results.filter((r) => r.c.group === g);
  console.log(`${g.padEnd(24)} ${rs.filter((r) => r.j.pass).length}/${rs.length}`);
}
console.log('\n' + JSON.stringify(summary, null, 2));

const failures = results.filter((r) => !r.j.pass);
if (failures.length) {
  console.log(`\nحالات لم تنجح (${failures.length}):`);
  for (const f of failures) {
    const why = f.error || `${f.o!.status}${f.o && f.c.expect === 'clean' ? ' · تغيّر النص' : ''}`;
    console.log(`- ${f.c.id} [${f.c.expect}] ${why}`);
  }
}

mkdirSync(join(import.meta.dirname, 'results'), { recursive: true });
const file = join(import.meta.dirname, 'results', `${mode}${label ? '-' + label : ''}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(
  file,
  JSON.stringify({ summary, results: results.map((r) => ({ id: r.c.id, run: r.run, expect: r.c.expect, pass: r.j.pass, outcome: r.o, error: r.error })) }, null, 2)
);
console.log(`\nحُفظت النتائج: ${file}`);
void scanHarsh;
