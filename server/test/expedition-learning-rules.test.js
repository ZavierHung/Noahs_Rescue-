import test from "node:test";
import assert from "node:assert/strict";
import {
  createGame,
  command,
  activePlayer,
  viewGame,
} from "../src/expedition/engine.js";
import { CARDS, CHARACTERS } from "../src/expedition/catalog.js";
import { TILES } from "../src/expedition/map.js";
import { canGather } from "../src/expedition/world.js";

const resourceTile = TILES.find(
  (tile) => tile.resource === "wood" && tile.zone === 1,
);
function make(learningMode = true, players = 3) {
  return createGame(
    {
      learningMode,
      players: CHARACTERS.slice(0, players).map((c, i) => ({
        characterId: c.id,
        flagId: `P${i + 1}`,
      })),
    },
    { seed: 11 },
  );
}
const act = (g, type, rest = {}) =>
  command(g, {
    type,
    actor: activePlayer(g).id,
    revision: g.revision,
    ...rest,
  });
function install(g, id) {
  g.pending = {
    kind: "technology",
    actor: "P1",
    choices: [id],
    resume: "cards",
  };
  g.phase = "choice";
  return act(g, "choose", { techId: id });
}
function gathering(g, round = 1, turn = 0) {
  g.phase = "gather";
  g.pending = null;
  g.round = round;
  g.turn = turn;
  g.players[turn].position = resourceTile.id;
  return g;
}

test("learning mode is opt-in, initializes peer review, and keeps old modes/rules intact", () => {
  const legacy = make(false),
    next = make();
  assert.equal(legacy.learningMode, undefined);
  assert.equal(legacy.peerReview, undefined);
  assert.equal(next.learningVersion, "student-learning-v1");
  assert.deepEqual(next.peerReview, { version: 1, submissions: [] });
  assert.deepEqual(next.rules, legacy.rules);
  assert.deepEqual(next.attributes, legacy.attributes);
  assert.equal(viewGame(legacy).peerReviewSummary.enabled, false);
});

test("drone deployment and optional boost expose a real marginal environmental cost", () => {
  let g = install(make(), "mining-drone");
  assert.deepEqual(g.attributes, { economy: 11, environment: 10, society: 10 });
  g = act(gathering(g), "gather");
  assert.equal(g.players[0].resources.wood, 1);
  assert.equal(g.attributes.environment, 10);
  g = act(gathering(g, 2), "gather", { boost: true });
  assert.equal(g.players[0].resources.wood, 3);
  assert.equal(g.attributes.environment, 9);
  assert.equal(g.players[0].worldImpact.environment, -1);
  assert.deepEqual(g.events.find((e) => e.type === "technology").status, {
    economy: 1,
  });
  assert.equal(g.events.filter((e) => e.type === "mining_boost").length, 1);
  const source = gathering(structuredClone(g), 3);
  const before = structuredClone(source);
  assert.throws(() => act(source, "gather", { boost: "yes" }), /布尔/);
  assert.deepEqual(source, before);
  const noDrone = gathering(make());
  assert.throws(() => act(noDrone, "gather", { boost: true }), /采矿无人机/);
  assert.equal(noDrone.attributes.environment, 10);
});

test("legacy drone remains automatic +1 with its original installation cost", () => {
  let g = install(make(false), "mining-drone");
  assert.deepEqual(g.attributes, { economy: 12, environment: 8, society: 10 });
  g = act(gathering(g), "gather");
  assert.equal(g.players[0].resources.wood, 2);
  assert.equal(g.attributes.environment, 8);
});

test("new supply order is frozen by actual inventory with deterministic seat ties", () => {
  const prepare = (learning) => {
    const g = make(learning);
    g.players[0].resources.wood = 4;
    return install(g, "shared-supply-pod");
  };
  const legacy = prepare(false);
  assert.deepEqual(legacy.pending.remaining, ["P1", "P2", "P3"]);
  let g = prepare(true);
  assert.deepEqual(g.pending.remaining, ["P2", "P3", "P1"]);
  assert.equal(g.pending.actor, "P2");
  assert.equal(
    g.events.find((e) => e.type === "supply_pool").policy,
    "lowest-inventory-first",
  );
  const before = g.players.map((p) =>
    Object.values(p.resources).reduce((a, b) => a + b, 0),
  );
  while (g.pending?.kind === "supply") {
    const resource = Object.keys(g.pending.pool).find(
      (r) => g.pending.pool[r] > 0,
    );
    g = act(g, "choose", { resource });
  }
  assert.deepEqual(
    g.players.map(
      (p, i) =>
        Object.values(p.resources).reduce((a, b) => a + b, 0) - before[i],
    ),
    [1, 1, 1],
  );
});

test("ecological collapse rests a global tile for one full round, without erasing history", () => {
  let g = make();
  g = act(g, "set_world", {
    attributes: { economy: 10, environment: 6, society: 10 },
    reason: "规则测试",
  });
  g = act(gathering(g, 2), "gather");
  assert.equal(g.world.harvested[resourceTile.id], 1);
  assert.equal(g.world.harvestedRound[resourceTile.id], 2);
  g = gathering(g, 2, 1);
  assert.equal(canGather(g, g.players[1]), false);
  const before = structuredClone(g);
  assert.throws(() => act(g, "gather"), /休养/);
  assert.deepEqual(g, before);
  g.round = 3;
  assert.equal(canGather(g, g.players[1]), false);
  g.round = 4;
  assert.equal(canGather(g, g.players[1]), true);
  g = act(g, "gather");
  assert.equal(g.world.harvested[resourceTile.id], 2);
  assert.equal(g.world.harvestedRound[resourceTile.id], 4);
  assert.match(
    viewGame(g).activeDisasters.find((d) => d.id === "eco-collapse")
      .effectSummary,
    /第r\+2轮恢复/,
  );
});

test("past harvest is remembered when collapse starts, legacy games stay permanently depleted", () => {
  for (const learning of [false, true]) {
    let g = act(gathering(make(learning), 1), "gather");
    g = act(g, "set_world", {
      attributes: { economy: 10, environment: 6, society: 10 },
      reason: "规则测试",
    });
    g = gathering(g, 8);
    assert.equal(canGather(g, g.players[0]), learning);
  }
});

test("learning card data keeps licensed source artwork/effects separate from implementation", () => {
  for (const id of ["mining-drone", "shared-supply-pod"]) {
    const card = CARDS.technology.find((c) => c.id === id);
    assert.ok(
      card.learningEffect && card.learningSummary && card.learningStatus,
    );
    assert.notEqual(card.learningImage, card.image);
    assert.match(card.image, /\.jpg$/);
    assert.match(card.learningImage, /-learning\.png$/);
  }
});
