import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadGodProfiles, parseGodPrompts } from '../src/god-prompts.js';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const markdownPath = path.resolve(testDirectory, '../../god.md');

test('all three complete god.md prompt blocks are parsed without losing their designed endings', async () => {
  const markdown = await readFile(markdownPath, 'utf8');
  const prompts = parseGodPrompts(markdown);

  assert.match(prompts.radical, /^你现在扮演“激进型上帝：增长与突破之神”/);
  assert.match(prompts.radical, /对“压迫扩张型”可以给予短期奖励，但必须附带后续风险或不稳定惩罚。$/);
  assert.match(prompts.balanced, /^你现在扮演“普通型上帝：平衡与共存之神”/);
  assert.match(prompts.balanced, /对“失衡低效型”给予轻微惩罚或警告。$/);
  assert.match(prompts.conservative, /^你现在扮演“保守型上帝：秩序与守护之神”/);
  assert.match(prompts.conservative, /对“过度开采型”“激进破坏型”“掠夺失序型”“无谓冒险型”给予负面效果。$/);
  assert.equal(createHash('sha256').update(prompts.radical).digest('hex'), '37bf387968f199d28787a2e75da4a141520897693db94bfa1407eb2589f6a137');
  assert.equal(createHash('sha256').update(prompts.balanced).digest('hex'), '5f6b83beac61804ccafd1f23f61f4d17b9f7fe31a57f6dfae2c533cf9b13bb72');
  assert.equal(createHash('sha256').update(prompts.conservative).digest('hex'), 'ccb8c0f7cc70c6fa38a69cbc6b44ab3a386d6f852dbf6608130ee58113d2ff4d');
});

test('loaded god profiles preserve the full prompt with source and reproducible hash', async () => {
  const profiles = await loadGodProfiles([
    { id: 'radical', name: '增长与突破之神' },
    { id: 'balanced', name: '平衡与共存之神' },
    { id: 'conservative', name: '秩序与守护之神' },
  ], markdownPath);

  assert.equal(profiles.length, 3);
  for (const profile of profiles) {
    assert.equal(profile.promptSource, 'god.md');
    assert.ok(profile.prompt.length > 500);
    assert.match(profile.promptHash, /^[a-f0-9]{64}$/);
  }
});
