import { generateText, Output } from 'ai';
import { z } from 'zod';
import { demoImprove, type ImproveResult } from '@/lib/demo';

export const maxDuration = 60;

const resultSchema = z.object({
  original: z.string(),
  improved: z.string(),
  toneScoreBefore: z.number().min(0).max(100),
  toneScoreAfter: z.number().min(0).max(100),
  flags: z.array(z.string()).max(6),
  explanation: z.string(),
  alternatives: z.object({
    formal: z.string(),
    friendly: z.string(),
    concise: z.string()
  })
});

const systemPrompt = `
أنت مساعد عربي متخصص في تحسين نبرة الرسائل قبل إرسالها.
هدفك ليس تغيير رأي المستخدم أو إقناعه بالتراجع، بل الحفاظ على المعنى والموقف مع تقليل احتمالات الإساءة وسوء الفهم.

قواعدك:
- افصل نقد الفكرة عن الشخص.
- أزل السخرية والتجريح والتعميم والاتهام القطعي عند وجودها.
- لا تجعل الرسالة متكلفة أو وعظية.
- حافظ على اللهجة العربية الطبيعية إذا كانت الرسالة عامية، وعلى الرسمية إذا كانت رسمية.
- لا تضف اعتذارًا أو مديحًا غير موجودين إلا عند الحاجة اللغوية الواضحة.
- إذا كانت الرسالة سليمة أصلًا، حسّن الوضوح فقط ولا تدّع وجود إساءة.
- عند تحليل صورة، استخرج النص المقصود بالنشر أو الإرسال ثم حسّنه.
- toneScoreBefore و toneScoreAfter هما "وضوح واحترام النبرة" وليس حكمًا أخلاقيًا على الشخص.
`;

export async function POST(req: Request) {
  const body = await req.json();
  const text = String(body.text || '').trim();
  const imageDataUrl = typeof body.imageDataUrl === 'string' ? body.imageDataUrl : '';

  if (!text && !imageDataUrl) {
    return Response.json({ error: 'أدخل نصًا أو ارفع صورة أولًا.' }, { status: 400 });
  }

  const model = process.env.AI_MODEL;
  if (!model) {
    if (imageDataUrl && !text) {
      const fallback: ImproveResult = {
        ...demoImprove('الصورة المرفوعة تحتاج تفعيل نموذج متعدد الوسائط لقراءة النص وتحسينه.'),
        flags: ['الصورة جاهزة للتحليل عند تفعيل الذكاء الاصطناعي']
      };
      return Response.json(fallback);
    }
    return Response.json(demoImprove(text));
  }

  try {
    const content: Array<
      | { type: 'text'; text: string }
      | { type: 'image'; image: string }
    > = [
      {
        type: 'text',
        text: text
          ? `حلّل الرسالة التالية وحسّنها مع الحفاظ على معناها:\n${text}`
          : 'اقرأ النص الظاهر في الصورة المرفقة، ثم حلله وحسّن صياغته مع الحفاظ على المعنى.'
      }
    ];

    if (imageDataUrl) content.push({ type: 'image', image: imageDataUrl });

    const { output } = await generateText({
      model,
      system: systemPrompt,
      output: Output.object({ schema: resultSchema }),
      messages: [{ role: 'user', content }]
    });

    return Response.json({ ...output, mode: 'ai' as const });
  } catch (error) {
    console.error(error);
    if (text) return Response.json(demoImprove(text));
    return Response.json({ error: 'تعذر تحليل الصورة الآن. فعّل نموذجًا يدعم الصور ثم أعد المحاولة.' }, { status: 503 });
  }
}
