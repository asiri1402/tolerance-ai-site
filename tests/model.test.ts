import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_EDITOR_MODEL, editorModel } from '../lib/ai/model';

test('نموذج الكتابة الافتراضي أقوى من AI_MODEL ويمكن تجاوزه', () => {
  const saved = process.env.AI_EDITOR_MODEL;
  try {
    delete process.env.AI_EDITOR_MODEL;
    assert.equal(editorModel(), DEFAULT_EDITOR_MODEL);
    assert.equal(DEFAULT_EDITOR_MODEL, 'anthropic/claude-sonnet-5.5');
    process.env.AI_EDITOR_MODEL = '  anthropic/claude-haiku-5.5 ';
    assert.equal(editorModel(), 'anthropic/claude-haiku-5.5');
    process.env.AI_EDITOR_MODEL = '   ';
    assert.equal(editorModel(), DEFAULT_EDITOR_MODEL);
  } finally {
    if (saved === undefined) delete process.env.AI_EDITOR_MODEL;
    else process.env.AI_EDITOR_MODEL = saved;
  }
});
