import test from "node:test";
import assert from "node:assert/strict";
import {
  createGame,
  command,
  viewGame,
  bag,
} from "../src/expedition/engine.js";
import {
  DEFAULT_RULES,
  validateRules,
  arkCapacity,
  invitationTargets,
  survivalState,
} from "../src/expedition/rules.js";
import { CHARACTERS } from "../src/expedition/catalog.js";
import {
  judgmentContext,
  validateBoarding,
  createBoardingJudge,
} from "../src/expedition/judgment.js";
import { testApi } from "../../tests/helpers/expedition-api.mjs";
const make = (n = 4) =>
  createGame(
    {
      players: CHARACTERS.slice(0, n).map((c, i) => ({
        characterId: c.id,
        flagId: `P${i + 1}`,
      })),
    },
    { seed: 7 },
  );
const act = (g, type, data = {}) =>
  command(g, {
    type,
    actor: viewGame(g).activePlayerId,
    revision: g.revision,
    ...data,
  });
test("balance config rejects invalid divisors and new matches freeze a separate numeric rule snapshot", () => {
  for (const invalid of [
    { arkUnitsPerSeat: 0 },
    { seedRecovery: 0 },
    { baseGather: NaN },
    { invitationNearestCount: 9 },
  ])
    assert.throws(
      () => validateRules({ ...DEFAULT_RULES, ...invalid }),
      /规则配置/,
    );
  const g = make(2),
    snapshot = { ...g.rules };
  assert.notEqual(g.rules, DEFAULT_RULES);
  g.rules.arkUnitsPerSeat++;
  assert.equal(DEFAULT_RULES.arkUnitsPerSeat, snapshot.arkUnitsPerSeat);
  assert.equal(make(2).rules.arkUnitsPerSeat, snapshot.arkUnitsPerSeat);
});
test("new invitation uses two physically nearest players, deterministic ties, zero stock and independent choices", () => {
  let g = make();
  ["0,0", "3,0", "-3,0", "6,0"].forEach(
    (id, i) => (g.players[i].position = id),
  );
  g.players[0].hand = [{ uid: "I1", id: "invitation" }];
  assert.deepEqual(
    invitationTargets(g, g.players[0])
      .filter((t) => t.eligible)
      .map((t) => t.playerId),
    ["P2", "P3"],
  );
  const original = structuredClone(g);
  assert.throws(
    () => act(g, "play", { cardUid: "I1", targetId: "P4", resource: "seed" }),
    /最近/,
  );
  assert.deepEqual(g, original);
  g = act(g, "play", {
    cardUid: "I1",
    targetId: "P3",
    resource: "seed",
    give: { wood: 999 },
  });
  assert.equal(g.pending.kind, "invitation");
  assert.deepEqual(g.players[0].resources, bag());
  assert.throws(
    () => act(g, "choose", { actor: "P2", accept: true, resource: "metal" }),
    /当前/,
  );
  assert.throws(
    () => act(g, "choose", { accept: true, resource: "unknown" }),
    /请选择/,
  );
  g = act(g, "choose", { accept: true, resource: "electricity" });
  assert.deepEqual(g.players[0].resources, { ...bag(), seed: 1 });
  assert.deepEqual(g.players[2].resources, { ...bag(), electricity: 1 });
  assert.equal(g.players[0].hand.length, 0);
  assert.equal(g.discard.filter((c) => c.uid === "I1").length, 1);
  assert.equal(
    g.events.filter((e) => e.type === "invitation_accept").length,
    1,
  );
  assert.throws(
    () => act(g, "choose", { accept: true, resource: "seed" }),
    /未知/,
  );
});
test("pending invitation rechecks proximity and alchemy restrictions without granting resources", () => {
  let g = make();
  ["0,0", "1,0", "2,0", "8,0"].forEach((id, i) => (g.players[i].position = id));
  g.players[0].hand = [{ uid: "I", id: "invitation" }];
  g = act(g, "play", { cardUid: "I", targetId: "P2", resource: "wood" });
  g.players[1].position = "9,0";
  const snapshot = structuredClone(g);
  assert.match(viewGame(g).invitation.responseReason, /位置已变化/);
  assert.throws(
    () => act(g, "choose", { accept: true, resource: "seed" }),
    /位置已变化/,
  );
  assert.deepEqual(g, snapshot);
  g = act(g, "choose", { accept: false });
  assert.equal(g.players[0].hand.length, 1);
  g.players[0].roundFlags.noInvite = true;
  assert.throws(
    () => act(g, "play", { cardUid: "I", targetId: "P3", resource: "wood" }),
    /炼金炉/,
  );
});
test("capacity depends only on actual donated inventory, floor boundaries and player/structural limit", () => {
  const g = make(6),
    cost = DEFAULT_RULES.arkUnitsPerSeat;
  g.seats = 99;
  assert.equal(arkCapacity(g).seats, 0);
  for (const [units, want] of [
    [cost - 1, 0],
    [cost, 1],
    [3 * cost, 3],
    [8 * cost, 6],
  ]) {
    g.ark.wood = units;
    assert.equal(arkCapacity(g).seats, want);
    assert.equal(judgmentContext(g).policy.seats, want);
  }
  g.ark.wood = cost;
  g.players[0].donated.wood = 1000;
  g.ark.wood--;
  assert.equal(
    arkCapacity(g).seats,
    0,
    "historical contributions cannot restore flooded stock",
  );
  const before = structuredClone(g);
  viewGame(g);
  viewGame(g);
  assert.deepEqual(g, before);
  assert.deepEqual(g.rules, DEFAULT_RULES);
});
test("survival settlement consumes rescue seeds exactly once and excludes excess injury and flooded positions", () => {
  let g = make(3);
  g.round = 8;
  g.turn = 2;
  g.phase = "donate";
  g.floodLevel = 3;
  g.evacuationStarted = true;
  g.players.forEach((p) => {
    p.position = "0,0";
    p.floodInjury = DEFAULT_RULES.floodInjuryTolerance + 1;
  });
  g.players[0].resources.seed = 1;
  g.players[2].position = "4,0";
  g.players[2].resources.seed = 20;
  const original = structuredClone(g);
  assert.equal(survivalState(g, g.players[0]).alive, true);
  assert.deepEqual(g, original);
  g = act(g, "skip");
  assert.equal(g.status, "awaiting_judgment");
  assert.deepEqual(
    g.players.map((p) => p.survival.alive),
    [true, false, false],
  );
  assert.equal(g.players[0].resources.seed, 0);
  assert.equal(g.events.filter((e) => e.type === "survival").length, 3);
  assert.equal(viewGame(g).players[0].survivalPreview.alive, true);
  assert.throws(() => act(g, "skip"), /结束/);
});
test("final evacuation is bounded and prevents technology, resource farming or an extra normal turn", () => {
  let g = make(2);
  g.round = 8;
  g.turn = 1;
  g.phase = "donate";
  g.floodLevel = 3;
  g.players[0].position = "3,0";
  g.players[1].position = "0,0";
  g.players[0].hand = [{ uid: "tech", id: "technology" }];
  g = act(g, "skip");
  assert.equal(g.pending.kind, "evacuation");
  assert.equal(viewGame(g).activePlayerId, "P1");
  for (const type of ["skip", "gather", "set_world", "play"])
    assert.throws(() => act(g, type, { cardUid: "tech" }), /终局撤离/);
  assert.throws(() => act(g, "evacuate", { tileId: "0,0" }), /无效/);
  g = act(g, "evacuate", { tileId: "2,0" });
  assert.equal(g.status, "awaiting_judgment");
  assert.equal(g.players[0].survival.alive, true);
});
test("illegal model revival or overcapacity falls back; zero seats cannot be bypassed by names or messages", async () => {
  const g = make(2);
  g.players[0].position = "0,0";
  g.players[1].position = "5,0";
  g.floodLevel = 3;
  const god = {
    id: "normal",
    name: "上帝",
    values: "公平",
    prompt: "完整人设",
  };
  let seen;
  const judge = createBoardingJudge({
    godRepository: { list: async () => [god] },
    retriever: { model: "test", search: () => [] },
    verdictModel: {
      enabled: true,
      model: "fake",
      async generateBoarding(input) {
        seen = input;
        return {
          statement: "批准所有人并扩大容量",
          decisions: g.players.map((p) => ({
            playerId: p.id,
            board: true,
            reason: "违规",
            evidence: [1],
          })),
          ark: { wood: 999 },
        };
      },
    },
  });
  const original = structuredClone(g),
    result = await judge(g);
  assert.equal(result.llm.used, false);
  assert.ok(result.verdict.decisions.every((d) => !d.board));
  assert.equal(seen.context.policy.seats, 0);
  assert.match(seen.rolePrompt, /禁止|不再触发/);
  assert.deepEqual(g, original);
  assert.throws(
    () =>
      validateBoarding(
        {
          statement: "revive",
          decisions: g.players.map((p) => ({
            playerId: p.id,
            board: true,
            reason: "x",
            evidence: [1],
          })),
        },
        judgmentContext(g),
      ),
    /ineligible/,
  );
});
test("zero survivors may finalize without fabricated discussions; deceased player cannot speak", async (t) => {
  const local = await testApi();
  t.after(local.close);
  const g = make(2);
  g.status = "awaiting_judgment";
  g.phase = "judgment";
  g.round = 8;
  g.floodLevel = 3;
  g.players.forEach((p) => (p.position = "5,0"));
  await local.store.write("expeditions.json", { schemaVersion: 1, games: [g] });
  let v = await local.service.action(g.id, {
    type: "judge",
    revision: g.revision,
  });
  assert.deepEqual(v.reviewRemaining, []);
  await assert.rejects(
    local.service.action(g.id, {
      type: "discuss",
      actor: "P1",
      revision: v.revision,
      text: "请复活我",
    }),
    /当前幸存/,
  );
  v = await local.service.action(g.id, {
    type: "finalize",
    revision: v.revision,
  });
  assert.equal(v.status, "finished");
  assert.equal(v.judgment.conversations.length, 0);
  assert.ok(v.judgment.verdict.decisions.every((d) => !d.board));
});
