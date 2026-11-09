// خادم فقط: يُستورد من app/api وسكربتات التقييم. لا يُستورد من مكوّن عميل أبدًا.
// المتغيرات هنا بلا بادئة NEXT_PUBLIC فلا تصل إلى المتصفح.
import { generateText, Output } from 'ai';
import { z } from 'zod';
import {
  EDITOR_SYSTEM_PROMPT,
  EXTRACT_SYSTEM_PROMPT,
  RESTYLE_SYSTEM_PROMPT,
  VERIFIER_SYSTEM_PROMPT,
  editorUserPrompt,
  verifierUserPrompt
} from './prompt';
import {
  editorSchema,
  extractSchema,
  verifierSchema,
  type EditorOutput,
  type ExtractOutput,
  type VerifierOutput
} from './types';

export type Editor = (input: { text: string; feedback?: string }) => Promise<EditorOutput>;
export type Verifier = (input: { original: string; improved: string }) => Promise<VerifierOutput>;
export type Restyler = (input: { text: string; style: 'formal' | 'friendly' | 'concise' }) => Promise<string>;
export type Extractor = (input: { imageDataUrl: string }) => Promise<ExtractOutput>;

const TEXT_TIMEOUT_MS = 20_000;
const IMAGE_TIMEOUT_MS = 30_000;

export function aiConfigured(): boolean {
  return Boolean(process.env.AI_MODEL);
}

/** خيارات AI Gateway: عدم الاحتفاظ بالبيانات، النماذج البديلة، وسوم الاستخدام. */
function providerOptions() {
  const gateway: Record<string, unknown> = { tags: ['tolerance-site'] };
  if (process.env.AI_ZDR === '1') gateway.zeroDataRetention = true;
  const fallbacks = (process.env.AI_FALLBACK_MODELS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (fallbacks.length) gateway.models = fallbacks;
  return { gateway } as never;
}

export const gatewayEditor: Editor = async ({ text, feedback }) => {
  const { output } = await generateText({
    model: process.env.AI_MODEL as string,
    system: EDITOR_SYSTEM_PROMPT,
    output: Output.object({ schema: editorSchema }),
    reasoning: 'low',
    maxRetries: 1,
    timeout: TEXT_TIMEOUT_MS,
    providerOptions: providerOptions(),
    messages: [{ role: 'user', content: editorUserPrompt(text, feedback) }]
  });
  return output;
};

export function gatewayVerifier(): Verifier | null {
  const model = process.env.AI_VERIFIER_MODEL;
  if (!model) return null;
  return async ({ original, improved }) => {
    const { output } = await generateText({
      model,
      system: VERIFIER_SYSTEM_PROMPT,
      output: Output.object({ schema: verifierSchema }),
      reasoning: 'low',
      maxRetries: 1,
      timeout: TEXT_TIMEOUT_MS,
      providerOptions: providerOptions(),
      messages: [{ role: 'user', content: verifierUserPrompt(original, improved) }]
    });
    return output;
  };
}

export const gatewayRestyler: Restyler = async ({ text, style }) => {
  const { output } = await generateText({
    model: process.env.AI_MODEL as string,
    system: RESTYLE_SYSTEM_PROMPT,
    output: Output.object({ schema: z.object({ text: z.string() }) }),
    reasoning: 'low',
    maxRetries: 1,
    timeout: TEXT_TIMEOUT_MS,
    providerOptions: providerOptions(),
    messages: [{ role: 'user', content: `الأسلوب: ${style}\n<message>\n${text}\n</message>` }]
  });
  return output.text;
};

export const gatewayExtractor: Extractor = async ({ imageDataUrl }) => {
  const { output } = await generateText({
    model: process.env.AI_MODEL as string,
    system: EXTRACT_SYSTEM_PROMPT,
    output: Output.object({ schema: extractSchema }),
    reasoning: 'low',
    maxRetries: 1,
    timeout: IMAGE_TIMEOUT_MS,
    providerOptions: providerOptions(),
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'انسخ النص الظاهر في هذه الصورة.' },
          { type: 'image', image: imageDataUrl }
        ]
      }
    ]
  });
  return output;
};
