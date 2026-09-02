import assert from 'node:assert/strict';
import test from 'node:test';

import { createMiniMaxVerdictModel } from '../src/llm/minimax.js';

const context = {
  god: { id: 'balanced', name: '平衡与共存之神', prompt: 'FULL_GOD_PROMPT_SENTINEL', promptFile: 'god-prompts/balanced.txt' },
  state: { attributes: { economy: 10, environment: 10, society: 10 } },
  evidence: [{ id: 'eco-01', content: '系统平衡提高韧性。' }],
  ruleDraft: { classification: '平衡发展型', tone: 'reward', title: '平衡回响', statement: '规则理由', measures: ['合作效率 +1'] },
};

test('MiniMax adapter stays disabled without an API key', () => {
  const model = createMiniMaxVerdictModel({ apiKey: '' });
  assert.equal(model.enabled, false);
  assert.deepEqual(model.describe(), { provider: 'minimax', protocol: 'anthropic-compatible', model: 'MiniMax-M3.0', enabled: false });
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
  const model = createMiniMaxVerdictModel({ apiKey: 'test-key-never-store', baseUrl: 'https://api.minimaxi.com/anthropic/', model: 'MiniMax-M3.0', fetchImpl });
  const verdict = await model.generateInitial(context);
  const body = JSON.parse(request.init.body);
  assert.equal(request.url, 'https://api.minimaxi.com/anthropic/v1/messages');
  assert.equal(request.init.headers.authorization, 'Bearer test-key-never-store');
  assert.equal(body.model, 'MiniMax-M3.0');
  assert.match(body.system, /FULL_GOD_PROMPT_SENTINEL/);
  assert.doesNotMatch(body.messages[0].content[0].text, /FULL_GOD_PROMPT_SENTINEL/);
  assert.equal(verdict.title, '平衡回响');
  assert.deepEqual(verdict.measures, ['合作效率 +1']);
});

test('MiniMax adapter includes the same complete god prompt in the final judgment system prompt', async () => {
  let request;
  const fetchImpl = async (url, init) => {
    request = { url, init };
    return {
      ok: true,
      async json() {
        return { content: [{ type: 'text', text: '{"tone":"mixed","title":"最终裁决","statement":"已听取反驳。","measures":["执行最终措施"],"unavoidable":true}' }] };
      },
    };
  };
  const model = createMiniMaxVerdictModel({ apiKey: 'test-key-never-store', fetchImpl });
  const verdict = await model.generateFinal({
    session: {
      god: context.god,
      stateSnapshot: context.state,
      rag: { evidence: context.evidence },
      initialVerdict: context.ruleDraft,
    },
    rebuttal: '我承诺合作修复。',
    recognizedRemedy: true,
    ruleDraft: { tone: 'mixed', title: '规则终判', statement: '规则回应', measures: ['规则措施'], unavoidable: true },
  });
  const body = JSON.parse(request.init.body);
  assert.match(body.system, /FULL_GOD_PROMPT_SENTINEL/);
  assert.match(body.messages[0].content[0].text, /我承诺合作修复/);
  assert.doesNotMatch(body.messages[0].content[0].text, /FULL_GOD_PROMPT_SENTINEL/);
  assert.equal(verdict.unavoidable, true);
});

test('MiniMax adapter retries malformed JSON once with a correction instruction', async () => {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, init });
    return {
      ok: true,
      async json() {
        return requests.length === 1
          ? { content: [{ type: 'text', text: '{"classification":"broken"' }] }
          : { content: [{ type: 'text', text: '{"classification":"平衡发展型","tone":"reward","title":"平衡回响","statement":"三维状态稳定。","measures":["合作效率 +1"]}' }] };
      },
    };
  };
  const model = createMiniMaxVerdictModel({ apiKey: 'test-key-never-store', fetchImpl });
  const verdict = await model.generateInitial(context);
  const retryBody = JSON.parse(requests[1].init.body);
  assert.equal(requests.length, 2);
  assert.match(retryBody.system, /FULL_GOD_PROMPT_SENTINEL/);
  assert.match(retryBody.messages[0].content[0].text, /无法被严格解析/);
  assert.equal(verdict.title, '平衡回响');
});

test('MiniMax adapter reports a safe error without exposing the API key', async () => {
  const secret = 'secret-must-not-leak';
  const model = createMiniMaxVerdictModel({ apiKey: secret, fetchImpl: async () => ({ ok: false, status: 401 }) });
  await assert.rejects(
    () => model.generateInitial(context),
    (error) => !error.message.includes(secret) && error.message === 'http_401',
  );
});
