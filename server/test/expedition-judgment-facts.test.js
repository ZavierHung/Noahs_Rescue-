import assert from "node:assert/strict";
import test from "node:test";
import { simulate } from "../src/expedition/simulation.js";
import {
  buildJudgmentFacts,
  JUDGMENT_FACTS_VERSION,
  withJudgmentFacts,
} from "../src/expedition/judgment-facts.js";
import {
  createBoardingJudge,
  fallbackBoarding,
  judgmentContext,
} from "../src/expedition/judgment.js";

// Fully local deterministic simulation. No .env, network, or player saves.
const { game } = simulate({ seed: 41, players: 6 });
const context = judgmentContext(game);
const get = (playerId, facts = context.facts) =>
  facts.players.find((p) => p.playerId === playerId);
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value))
    return value;
  Object.freeze(value);
  for (const item of Object.values(value)) deepFreeze(item);
  return value;
}

test("P2's authoritative donation totals do not absorb public supplies or another player's donations", () => {
  const p2 = get("P2");
  assert.equal(context.policy.version, "boarding-v3");
  assert.equal(context.facts.version, JUDGMENT_FACTS_VERSION);
  assert.deepEqual(p2.donatedTotals, {
    wood: 4,
    metal: 0,
    electricity: 1,
    seed: 0,
  });
  assert.equal(p2.donatedTotalUnits, 5);
  assert.deepEqual(
    p2.donationEvents.map((e) => e.seq),
    [131, 572, 659],
  );
  assert.deepEqual(
    p2.donationEvents.map((e) => e.amounts),
    [
      { wood: 3, metal: 0, electricity: 0, seed: 0 },
      { wood: 1, metal: 0, electricity: 0, seed: 0 },
      { wood: 0, metal: 0, electricity: 1, seed: 0 },
    ],
  );
  assert.equal(p2.publicSupplyEvents.length, 2);
  assert.equal(p2.technologyCounts["ruins-blueprint"], undefined);
  assert.deepEqual(p2.technologyCounts, {
    "space-ring": 1,
    "shared-supply-pod": 2,
  });
});

test("P4's repair precedes later ecological damage, and only applied deltas are facts", () => {
  const p4 = get("P4");
  assert.deepEqual(
    p4.technologyUses.map(({ seq, round, cardId }) => ({ seq, round, cardId })),
    [
      { seq: 319, round: 4, cardId: "black-tide-alarm" },
      { seq: 485, round: 6, cardId: "ruins-blueprint" },
    ],
  );
  assert.deepEqual(
    p4.worldChanges.map((e) => [e.seq, e.actualDelta.environment]),
    [
      [318, 1],
      [484, -1],
    ],
  );
  const clamped = get("P2").worldChanges.find((e) => e.seq === 544);
  assert.equal(clamped.requestedDelta.environment, -2);
  assert.equal(clamped.actualDelta.environment, -1);
  assert.equal(
    context.facts.systemWorldChanges.find((e) => e.seq === 547).actualDelta
      .environment,
    0,
  );
});

test("P6 has one ecological repeller, not P5's later use or a duplicated world-change event", () => {
  const p6 = get("P6");
  assert.equal(p6.technologyCounts["ecological-repeller"], 1);
  assert.deepEqual(
    p6.technologyUses
      .filter((e) => e.cardId === "ecological-repeller")
      .map((e) => e.seq),
    [215],
  );
  assert.equal(p6.technologyUseCount, 2);
  assert.equal(
    p6.worldChanges.find((e) => e.seq === 214).actualDelta.environment,
    1,
  );
  assert.ok(!p6.technologyUses.some((e) => [214, 683, 684].includes(e.seq)));
  assert.equal(get("P5").technologyUses.find((e) => e.seq === 684).actor, "P5");
  assert.equal(get("P5").technologyCounts["ruins-blueprint"], 1);
  assert.equal(get("P1").technologyCounts["ruins-blueprint"], 2);
});

test("the inviter and invited player each receive an attributed cooperation fact", () => {
  const recipient = get("P1").cooperationEvents.find((e) => e.seq === 699);
  const inviter = get("P6").cooperationEvents.find((e) => e.seq === 699);
  assert.equal(recipient.actor, "P6");
  assert.equal(recipient.targetId, "P1");
  assert.equal(recipient.role, "recipient");
  assert.equal(recipient.counterpartyId, "P6");
  assert.equal(inviter.role, "initiator");
  assert.equal(inviter.counterpartyId, "P1");
  assert.equal(recipient.recipientResource, "seed");
  assert.equal(get("P1").cooperationCount, 12);
  assert.equal(get("P6").cooperationCount, 10);
  assert.ok(!get("P3").cooperationEvents.some((e) => e.seq === 699));
});

test("flood payments, final escape and survival are separate attributable evidence", () => {
  assert.deepEqual(
    context.facts.globalFloodEvents.map((e) => [
      e.seq,
      e.round,
      e.requested,
      e.actual,
    ]),
    [
      [267, 3, 1, 1],
      [433, 5, 2, 2],
      [621, 7, 3, 3],
    ],
  );
  const p1 = get("P1");
  assert.deepEqual(
    p1.floodPayments.map((e) => e.seq),
    [269, 435, 623],
  );
  assert.equal(p1.floodPayments[0].injury, 1);
  assert.equal(p1.survival.seedsUsed, 1);
  assert.equal(p1.survivalEvents[0].seq, 716);
  assert.equal(p1.eligible, true);
  assert.deepEqual(
    p1.evacuationEvents.map((e) => e.seq),
    [713],
  );
  assert.deepEqual(get("P4").evacuationEvents, []);
});

test("facts never mutate the context, share mutable outputs, or infer technology from future equipment", () => {
  const original = structuredClone(context);
  delete original.facts;
  const baseline = structuredClone(original);
  deepFreeze(original);
  const facts = buildJudgmentFacts(original);
  assert.deepEqual(original, baseline);
  facts.players[1].donatedTotals.metal = 999;
  facts.players[0].floodPayments[0].lost.wood = 999;
  assert.deepEqual(original, baseline);

  const polluted = structuredClone(baseline);
  polluted.globalEvents.push({
    seq: 9000,
    round: 1,
    actor: "P6",
    type: "action",
    effects: [
      {
        playerId: "P6",
        equipment: ["ecological-repeller", "ecological-repeller"],
      },
    ],
  });
  for (const player of polluted.players)
    player.equipment = ["ecological-repeller", "ruins-blueprint"];
  assert.deepEqual(buildJudgmentFacts(polluted), buildJudgmentFacts(baseline));
});

test("missing historical applied delta is derived only from numeric before/after, never requested", () => {
  const minimal = {
    players: [
      { id: "P1", donated: { wood: 9, metal: 0, electricity: 0, seed: 0 } },
    ],
    globalEvents: [
      {
        seq: 3,
        round: 2,
        actor: "P1",
        type: "world_change",
        requested: { economy: 4 },
        before: { economy: 18, environment: 10, society: 10 },
        after: { economy: 19, environment: 10, society: 10 },
      },
      {
        seq: 2,
        round: 1,
        actor: "P1",
        type: "world_change",
        requested: { economy: 4 },
      },
    ],
  };
  const facts = buildJudgmentFacts(minimal);
  assert.deepEqual(
    facts.players[0].worldChanges.map((e) => e.seq),
    [2, 3],
  );
  assert.equal(facts.players[0].worldChanges[0].actualDelta, null);
  assert.equal(facts.players[0].worldChanges[1].actualDelta.economy, 1);
  assert.equal(
    facts.players[0].donatedTotals.wood,
    9,
    "player.donated stays authoritative even if old logs are incomplete",
  );
  assert.deepEqual(facts.players[0].donationEvents, []);
});

test("legacy frozen council context is enriched without reading later game facts or overwriting history", async () => {
  const god = {
    id: "balanced",
    name: "测试上帝",
    values: "合作",
    prompt: "完整测试人设",
  };
  const frozenContext = structuredClone(context);
  delete frozenContext.facts;
  const oldVerdict = fallbackBoarding(frozenContext, god);
  const current = structuredClone(game);
  current.players[1].donated.metal = 999;
  current.events.push({
    seq: 9000,
    round: 8,
    actor: "P6",
    type: "technology",
    cardId: "ecological-repeller",
  });
  current.judgment = {
    god,
    context: frozenContext,
    verdict: oldVerdict,
    conversations: [],
    history: [{ stage: "initial", verdict: oldVerdict, rag: { evidence: [] } }],
  };
  const before = structuredClone(current);
  deepFreeze(current.judgment);
  let modelContext;
  const judge = createBoardingJudge({
    godRepository: { list: async () => [god], get: async () => god },
    retriever: { model: "test", search: async () => [] },
    verdictModel: {
      enabled: true,
      model: "test",
      generateBoarding: async ({ context: received }) => {
        modelContext = received;
        return fallbackBoarding(received, god);
      },
    },
  });
  const result = await judge(current, {
    stage: "discussion",
    playerId: "P1",
    text: "请核对我的真实事件。",
  });
  assert.equal(result.llm.used, true);
  assert.equal(get("P2", modelContext.facts).donatedTotals.metal, 0);
  assert.equal(
    get("P6", modelContext.facts).technologyCounts["ecological-repeller"],
    1,
  );
  assert.equal(result.context.globalEvents.length, context.globalEvents.length);
  assert.equal(result.context.facts.version, JUDGMENT_FACTS_VERSION);
  assert.equal(current.judgment.context.facts, undefined);
  assert.deepEqual(result.history[0], before.judgment.history[0]);
  assert.deepEqual(current, before);
});

test("current facts are reused; upgrading an older facts version never overwrites its snapshot", () => {
  assert.equal(withJudgmentFacts(context), context);
  const old = structuredClone(context);
  old.facts = { version: "old-test-version", marker: "preserve-old-snapshot" };
  deepFreeze(old);
  const upgraded = withJudgmentFacts(old);
  assert.notEqual(upgraded, old);
  assert.equal(upgraded.facts.version, JUDGMENT_FACTS_VERSION);
  assert.deepEqual(old.facts, {
    version: "old-test-version",
    marker: "preserve-old-snapshot",
  });
});
