import assert from 'node:assert/strict';
import test from 'node:test';

import { createMiniMaxVerdictModel } from '../src/llm/minimax.js';

const context = {
  god: { id: 'balanced', name: '平衡与共存之神' },
  state: { attributes: { economy: 10, environment: 10, society: 10 } },
  evidence: [{ id: 'eco-01', content: '系统平衡提高韧性。' }],
  ruleDraft: { classification: '平衡发展型', tone: 'reward', title: '平衡回响', statement: '规则理由', measures: ['合作效率 +1'] },
};

test('MiniMax adapter stays disabled without an API key', () => {
  const model = createMiniMaxVerdictModel({ apiKey: '' });
  assert.equal(model.enabled, false);
  assert.deepEqual(model.describe(), { provider: 'minimax', protocol: 'anthropic-compatible', model: 'MiniMax-M2.7', enabled: false });
});

test('MiniMax adapter calls Anthropic-compatible Messages API and parses JSON', async () => {
  let request;
  const fetchImpl = async (url, init) => {
    request = { url, init };
    return {
      ok: true,
      async json() {
        return { content: [{ type: 'thinking', thinking: 'internal' }, { type: 'text', text: '```json\n{"classification":"平衡发展型","tone":"reward","title":"平衡回响","statement":"三维状态稳定。","measures":["合作效率 +1"]}\n```' }] };
      },
    };
  };
  const model = createMiniMaxVerdictModel({ apiKey: 'test-key-never-store', baseUrl: 'https://api.minimaxi.com/anthropic/', model: 'MiniMax-M2.7', fetchImpl });
  const verdict = await model.generateInitial(context);
  const body = JSON.parse(request.init.body);
  assert.equal(request.url, 'https://api.minimaxi.com/anthropic/v1/messages');
  assert.equal(request.init.headers.authorization, 'Bearer test-key-never-store');
  assert.equal(body.model, 'MiniMax-M2.7');
  assert.equal(verdict.title, '平衡回响');
  assert.deepEqual(verdict.measures, ['合作效率 +1']);
});

test('MiniMax adapter reports a safe error without exposing the API key', async () => {
  const secret = 'secret-must-not-leak';
  const model = createMiniMaxVerdictModel({ apiKey: secret, fetchImpl: async () => ({ ok: false, status: 401 }) });
  await assert.rejects(
    () => model.generateInitial(context),
    (error) => !error.message.includes(secret) && error.message === 'http_401',
  );
});
