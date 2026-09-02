import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createGodRepository } from '../src/god-repository.js';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'god-repository-'));
  await mkdir(path.join(directory, 'god-prompts'));
  await writeFile(path.join(directory, 'gods.json'), JSON.stringify([
    { id: 'balanced', name: '平衡神', type: '普通型', values: '平衡', voice: '保持平衡。', promptFile: 'god-prompts/balanced.txt' },
  ]));
  await writeFile(path.join(directory, 'god-prompts/balanced.txt'), '第一版完整提示词');
  return directory;
}

test('god repository loads prompt content from the dedicated data backend', async (context) => {
  const directory = await fixture();
  context.after(() => rm(directory, { recursive: true, force: true }));
  const repository = createGodRepository(directory);
  const [god] = await repository.list();
  assert.equal(god.prompt, '第一版完整提示词');
  assert.deepEqual(await repository.describe(), { source: 'data-backend', loaded: 1 });
});

test('god repository reflects backend prompt edits on the next read without restart', async (context) => {
  const directory = await fixture();
  context.after(() => rm(directory, { recursive: true, force: true }));
  const repository = createGodRepository(directory);
  assert.equal((await repository.get('balanced')).prompt, '第一版完整提示词');
  await writeFile(path.join(directory, 'god-prompts/balanced.txt'), '第二版完整提示词，立即同步');
  assert.equal((await repository.get('balanced')).prompt, '第二版完整提示词，立即同步');
});

test('god repository keeps prompt files inside its data backend directory', async (context) => {
  const directory = await fixture();
  context.after(() => rm(directory, { recursive: true, force: true }));
  const definitions = [{ id: 'balanced', name: '平衡神', type: '普通型', values: '平衡', voice: '保持平衡。', promptFile: '../god.md' }];
  await writeFile(path.join(directory, 'gods.json'), JSON.stringify(definitions));
  await assert.rejects(() => createGodRepository(directory).list(), /outside_data_backend/);
});

test('god repository rejects unknown ids, duplicate ids and empty prompts explicitly', async (context) => {
  const directory = await fixture();
  context.after(() => rm(directory, { recursive: true, force: true }));
  const repository = createGodRepository(directory);
  await assert.rejects(() => repository.get('missing'), /god_profile_missing:missing/);

  const duplicate = { id: 'balanced', name: '另一个平衡神', type: '普通型', values: '平衡', voice: '重复。', promptFile: 'god-prompts/balanced.txt' };
  const original = { id: 'balanced', name: '平衡神', type: '普通型', values: '平衡', voice: '保持平衡。', promptFile: 'god-prompts/balanced.txt' };
  await writeFile(path.join(directory, 'gods.json'), JSON.stringify([original, duplicate]));
  await assert.rejects(() => repository.list(), /god_definition_duplicate:balanced/);

  await writeFile(path.join(directory, 'gods.json'), JSON.stringify([original]));
  await writeFile(path.join(directory, 'god-prompts/balanced.txt'), '   \n');
  await assert.rejects(() => repository.list(), /god_prompt_empty:balanced/);
});

test('production data backend contains all three complete designed prompts', async () => {
  const repository = createGodRepository(path.resolve(testDirectory, '../data'));
  const gods = Object.fromEntries((await repository.list()).map((god) => [god.id, god]));
  assert.deepEqual(Object.keys(gods).sort(), ['balanced', 'conservative', 'radical']);
  assert.match(gods.radical.prompt, /^你现在扮演“激进型上帝：增长与突破之神”/);
  assert.match(gods.radical.prompt, /对“压迫扩张型”可以给予短期奖励，但必须附带后续风险或不稳定惩罚。$/);
  assert.match(gods.balanced.prompt, /^你现在扮演“普通型上帝：平衡与共存之神”/);
  assert.match(gods.balanced.prompt, /对“失衡低效型”给予轻微惩罚或警告。$/);
  assert.match(gods.conservative.prompt, /^你现在扮演“保守型上帝：秩序与守护之神”/);
  assert.match(gods.conservative.prompt, /对“过度开采型”“激进破坏型”“掠夺失序型”“无谓冒险型”给予负面效果。$/);
});
