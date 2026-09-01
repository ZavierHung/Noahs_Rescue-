import assert from 'node:assert/strict';
import test from 'node:test';

import { createAgentLoop } from '../src/agent-loop.js';

const gods = [
  { id: 'balanced', name: '平衡与共存之神', type: '普通型', values: '平衡 合作 可持续', voice: '保持动态平衡。' },
];
const retriever = {
  model: 'local-test-model',
  search: () => [{ id: 'eco-test', title: '测试知识', content: '三维平衡提高韧性。', score: 0.9 }],
};
const fixedNow = () => '2026-09-02T00:00:00.000Z';

test('agent loop reads state, selects god, retrieves evidence and awaits rebuttal', () => {
  const loop = createAgentLoop({ gods, retriever, random: () => 0, now: fixedNow });
  const session = loop.start({ round: 1, attributes: { economy: 10, environment: 10, society: 10 }, activeDisasters: [] });
  assert.equal(session.status, 'awaiting_rebuttal');
  assert.equal(session.god.id, 'balanced');
  assert.equal(session.rag.model, 'local-test-model');
  assert.equal(session.rag.evidence[0].id, 'eco-test');
  assert.equal(session.initialVerdict.title, '平衡回响');
  assert.equal(session.trace.at(-1).step, 'await_rebuttal');
});

test('rebuttal is heard, but final measures are always produced', () => {
  const loop = createAgentLoop({ gods, retriever, random: () => 0, now: fixedNow });
  const session = loop.start({ round: 1, attributes: { economy: 17, environment: 5, society: 8 }, activeDisasters: [] });
  const final = loop.rebut(session, '我承诺下一轮进行生态修复并共享资源。');
  assert.equal(final.status, 'final');
  assert.equal(final.rebuttal.recognizedRemedy, true);
  assert.equal(final.finalVerdict.unavoidable, true);
  assert.ok(final.finalVerdict.measures.length > 0);
  assert.match(final.finalVerdict.measures[0], /减免/);
  assert.equal(final.trace.at(-1).step, 'archive_json');
});

test('a finalized hearing cannot be rebutted twice', () => {
  const loop = createAgentLoop({ gods, retriever, random: () => 0, now: fixedNow });
  const session = loop.start({ round: 1, attributes: { economy: 10, environment: 10, society: 10 }, activeDisasters: [] });
  const final = loop.rebut(session, '我会合作修复。');
  assert.throws(() => loop.rebut(final, '再次反驳'), /不能再次反驳/);
});

test('manual trigger can start multiple independent hearings', () => {
  const loop = createAgentLoop({ gods, retriever, random: () => 0, now: fixedNow });
  const state = { round: 1, attributes: { economy: 10, environment: 10, society: 10 }, activeDisasters: [] };
  const first = loop.start(state);
  const second = loop.start(state);
  assert.notEqual(first.id, second.id);
  assert.equal(first.status, 'awaiting_rebuttal');
  assert.equal(second.status, 'awaiting_rebuttal');
});
