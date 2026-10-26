import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { testApi } from "../../tests/helpers/expedition-api.mjs";
import { CHARACTERS } from "../src/expedition/catalog.js";
import { simulate } from "../src/expedition/simulation.js";
import { createExpeditionService } from "../src/expedition/service.js";
import {
  createBoardingJudge,
  judgmentContext,
  validateBoarding,
} from "../src/expedition/judgment.js";
import { createMiniMaxVerdictModel } from "../src/llm/minimax.js";
const setup = {
  players: CHARACTERS.slice(0, 3).map((c, i) => ({
    characterId: c.id,
    flagId: `P${i + 1}`,
  })),
};
test("cold initialization and concurrent create/list cannot overwrite saved matches", async () => {
  let persisted;
  const store = {
    async read(_name, fallback) {
      if (!persisted) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        persisted = structuredClone(fallback);
      }
      return structuredClone(persisted);
    },
    async write(_name, data) {
      persisted = structuredClone(data);
    },
  };
  const service = createExpeditionService({ store });
  const results = await Promise.all([
    service.list(),
    service.create(setup),
    service.create(setup),
  ]);
  assert.equal((await service.list()).length, 2);
  assert.notEqual(results[1].id, results[2].id);
});
test("HTTP creation, refresh, concurrent duplicate action, stale revision and persistence", async (t) => {
  const local = await testApi();
  t.after(local.close);
  const create = await fetch(`${local.base}/api/expeditions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(setup),
  });
  assert.equal(create.status, 201);
  const game = await create.json();
  assert.equal(game.rng, undefined);
  const input = { type: "skip", actor: "P1", revision: game.revision };
  const results = await Promise.all([
    local.service.action(game.id, input),
    local.service.action(game.id, input).catch((e) => e),
  ]);
  assert.equal(results[0].phase, "move");
  assert.match(results[1].message, /状态已更新/);
  const restarted = createExpeditionService({
    store: local.store,
    judge: () => {
      throw new Error("not needed");
    },
  });
  assert.equal((await restarted.get(game.id)).revision, 2);
  const response = await fetch(
    `${local.base}/api/expeditions/${game.id}/actions`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  assert.equal(response.status, 409);
  assert.equal((await local.service.get(game.id)).phase, "move");
  const saved = JSON.parse(
    await readFile(`${local.directory}/expeditions.json`, "utf8"),
  );
  assert.equal(saved.games[0].revision, 2);
});
test("terminal judge sees complete global events, RAG and full persona; one verdict, one rebuttal; game sealed", async (t) => {
  const local = await testApi();
  t.after(local.close);
  const { game } = simulate({ seed: 41, players: 3 });
  game.id = "EXP-TEST1234";
  await local.store.write("expeditions.json", {
    schemaVersion: 1,
    games: [game],
  });
  const result = await local.service.action(game.id, {
    type: "judge",
    revision: game.revision,
  });
  assert.equal(result.status, "review");
  assert.equal(result.judgment.context.globalEvents.length, game.events.length);
  assert.equal(result.judgment.context.donations.length, game.donations.length);
  assert.equal(result.judgment.verdict.decisions.length, 3);
  assert.ok(result.judgment.rag.evidence.length);
  assert.equal(result.judgment.llm.used, false);
  assert.deepEqual(
    await local.service.action(game.id, {
      type: "judge",
      revision: game.revision,
    }),
    result,
  );
  const final = await local.service.action(game.id, {
    type: "rebut",
    revision: result.revision,
    text: "请结合我的实际捐赠与合作记录复核。",
  });
  assert.equal(final.status, "finished");
  assert.equal(final.judgment.final, true);
  assert.deepEqual(final.judgment.context, result.judgment.context);
  assert.equal(final.judgment.history.length, 2);
  assert.deepEqual(final.judgment.history[0].verdict, result.judgment.verdict);
  assert.match(final.judgment.history[1].rebuttal, /合作记录/);
  await assert.rejects(
    local.service.action(game.id, {
      type: "skip",
      revision: final.revision,
      actor: "P1",
    }),
    /结束/,
  );
  await assert.rejects(
    local.service.action(game.id, {
      type: "rebut",
      revision: final.revision,
      text: "再来",
    }),
    /一次/,
  );
});
test("valid M3 boarding and rebuttal preserve complete decisions without exposing full prompt", async () => {
  const { game } = simulate({ seed: 7, players: 6 });
  const requests = [];
  const god = {
    id: "balanced",
    name: "普通上帝",
    values: "平衡",
    prompt: "完整人格，逐项判断每位玩家。",
  };
  const verdict = {
    statement: "依据本局记录，暂不允许登舟。",
    decisions: game.players.map((p) => ({
      playerId: p.id,
      board: false,
      reason: "核对捐赠与位置。",
      evidence: [1],
    })),
  };
  const model = createMiniMaxVerdictModel({
    apiKey: "fake-test-only",
    fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: JSON.stringify(verdict) }],
        }),
      );
    },
  });
  const judge = createBoardingJudge({
    godRepository: { list: async () => [god], get: async () => god },
    retriever: { model: "test-local", search: () => [] },
    verdictModel: model,
    random: () => 0,
  });
  game.judgment = await judge(game);
  const final = await judge(game, { rebuttal: "请核对实际捐赠。" });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].max_tokens, 3000);
  assert.match(requests[1].messages[0].content[0].text, /请核对实际捐赠/);
  assert.match(requests[1].messages[0].content[0].text, /previous/);
  assert.equal(final.llm.used, true);
  assert.equal(final.history.length, 2);
  assert.equal(final.god.prompt, undefined);
});
test("boarding validates each player, eligibility, seat limit and real event references", () => {
  const { game } = simulate({ seed: 1, players: 3 });
  const context = judgmentContext(game);
  const valid = {
    statement: "说明",
    decisions: context.players.map((p) => ({
      playerId: p.id,
      board: false,
      reason: "证据",
      evidence: [1],
    })),
  };
  assert.deepEqual(validateBoarding(valid, context), valid);
  for (const change of [
    (v) => v.decisions.pop(),
    (v) => (v.decisions[0].playerId = "fake"),
    (v) => (v.decisions[0].evidence = [999999]),
    (v) => (v.decisions[0].evidence = []),
    (v) => (v.decisions[1].playerId = v.decisions[0].playerId),
  ]) {
    const v = structuredClone(valid);
    change(v);
    assert.throws(() => validateBoarding(v, context), /invalid/);
  }
  context.policy.seats = 1;
  context.players.forEach((p) => (p.eligible = true));
  const tooMany = structuredClone(valid);
  tooMany.decisions.forEach((d) => (d.board = true));
  assert.throws(() => validateBoarding(tooMany, context), /capacity/);
  context.players[0].eligible = false;
  const wrong = structuredClone(valid);
  wrong.decisions[0].board = true;
  assert.throws(() => validateBoarding(wrong, context), /ineligible/);
});
test("M3 terminal prompt includes full persona, global causality and rebuttal; invalid output safely falls back", async () => {
  const { game } = simulate({ seed: 5, players: 2 });
  let requestBody;
  const god = {
    id: "normal",
    name: "普通上帝",
    values: "平衡",
    prompt: "完整的角色设计，不能被简化。",
  };
  const model = createMiniMaxVerdictModel({
    apiKey: "fake-test-only",
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          content: [
            {
              type: "text",
              text: JSON.stringify({
                statement: "invalid player",
                decisions: [],
              }),
            },
          ],
        }),
        { status: 200 },
      );
    },
  });
  const judge = createBoardingJudge({
    godRepository: { list: async () => [god] },
    retriever: {
      model: "test-local",
      search: () => [{ id: "K1", title: "公平", content: "资源合作" }],
    },
    verdictModel: model,
    random: () => 0,
  });
  const result = await judge(game);
  assert.match(requestBody.system, /完整的角色设计/);
  assert.match(requestBody.messages[0].content[0].text, /globalEvents/);
  assert.match(requestBody.messages[0].content[0].text, /donations/);
  assert.match(requestBody.messages[0].content[0].text, /资源合作/);
  assert.equal(result.llm.used, false);
  assert.equal(result.llm.fallbackReason, "model_or_validation_failed");
  assert.equal(result.god.prompt, undefined);
});
