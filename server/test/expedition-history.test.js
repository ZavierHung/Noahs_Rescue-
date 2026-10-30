import test from "node:test";
import assert from "node:assert/strict";
import { createGame, viewGame } from "../src/expedition/engine.js";
import { createExpeditionService } from "../src/expedition/service.js";
import { gameplayState, HISTORY_LIMIT } from "../src/expedition/history.js";
import { CHARACTERS } from "../src/expedition/catalog.js";
import { TILES } from "../src/expedition/map.js";
import { botAction } from "../src/expedition/simulation.js";
import {
  judgmentContext,
  fallbackBoarding,
} from "../src/expedition/judgment.js";
import { testApi } from "../../tests/helpers/expedition-api.mjs";

function make(n = 3) {
  return createGame(
    {
      players: CHARACTERS.slice(0, n).map((c, i) => ({
        characterId: c.id,
        flagId: `P${i + 1}`,
      })),
    },
    { seed: 41 },
  );
}
async function harness(game = make(), judge) {
  let data = { schemaVersion: 1, games: [structuredClone(game)] },
    fail = false;
  const store = {
    read: async () => structuredClone(data),
    write: async (_, value) => {
      if (fail) throw new Error("disk unavailable");
      data = structuredClone(value);
    },
  };
  const service = createExpeditionService({ store, judge });
  await service.list();
  return {
    service,
    store,
    raw: () => structuredClone(data.games[0]),
    fail: (value) => {
      fail = value;
    },
    async act(type, values = {}) {
      const current = await service.get(game.id);
      return service.action(game.id, {
        type,
        actor: current.activePlayerId,
        revision: current.revision,
        ...values,
      });
    },
  };
}
function state(game) {
  const result = gameplayState(game);
  delete result.revision;
  return result;
}
function publicSafe(game) {
  const json = JSON.stringify(game);
  assert.ok(!json.includes('"rng"'));
  assert.ok(!json.includes('"snapshot"'));
  assert.ok(!json.includes('"historyState"'));
}

test("legacy saves start with empty history; reads and failed commands do not create checkpoints", async () => {
  const h = await harness(),
    before = h.raw();
  const view = await h.service.get(before.id);
  assert.equal(view.history.undoCount, 0);
  await assert.rejects(h.act("undo"), /没有可撤回/);
  await assert.rejects(h.act("redo"), /没有可重做/);
  await assert.rejects(h.act("gather"), /采集/);
  assert.deepEqual(h.raw(), before);
  await h.act("skip");
  assert.equal((await h.service.get(before.id)).history.undoCount, 1);
  await assert.rejects(h.act("undo", { actor: "P2" }), /当前行动玩家/);
  assert.equal((await h.service.get(before.id)).history.undoCount, 1);
});

test("movement, collection and donation undo/redo restore the entire game and cross-player turn", async () => {
  const g = make();
  const tile = TILES.find((t) => t.resource);
  g.players[0].position = tile.id;
  g.phase = "move";
  const h = await harness(g),
    initial = h.raw(),
    checkpoints = [initial];
  await h.act("move", { tileId: tile.id });
  checkpoints.push(h.raw());
  await h.act("gather");
  checkpoints.push(h.raw());
  const amounts = {
    wood: 0,
    metal: 0,
    electricity: 0,
    seed: 0,
    [tile.resource]: 1,
  };
  let view = await h.act("donate", { amounts });
  const donated = h.raw();
  assert.equal(view.activePlayerId, "P2");
  assert.equal(view.ark[tile.resource], 1);
  assert.equal(view.donations.length, 1);
  await assert.rejects(h.act("undo", { actor: "P1" }), /当前行动玩家/);
  for (const expected of checkpoints.toReversed()) {
    view = await h.act("undo");
    assert.deepEqual(state(h.raw()), state(expected));
    assert.equal(view.activePlayerId, "P1");
    publicSafe(view);
  }
  for (let i = 0; i < 3; i++) view = await h.act("redo");
  assert.deepEqual(state(h.raw()), state(donated));
  assert.equal(view.revision, donated.revision + 6);
  assert.equal(view.historyAudit.length, 6);
  assert.deepEqual(
    view.historyAudit.map((a) => a.seq),
    [1, 2, 3, 4, 5, 6],
  );
  assert.equal(view.historyAudit[0].actor, "P2");
  assert.ok(view.historyAudit[0].events.some((e) => e.type === "donation"));
});

test("invitation undo restores both inventories, consumed card, and the correct pending responder", async () => {
  const g = make();
  g.players[0].hand = [{ uid: "INV", id: "invitation" }];
  const h = await harness(g),
    initial = h.raw();
  await h.act("play", { cardUid: "INV", targetId: "P2", resource: "seed" });
  const offered = h.raw();
  await h.act("choose", { accept: true, resource: "metal" });
  const accepted = h.raw();
  assert.equal(accepted.players[0].resources.seed, 1);
  assert.equal(accepted.players[1].resources.metal, 1);
  let view = await h.act("undo");
  assert.deepEqual(state(h.raw()), state(offered));
  assert.equal(view.activePlayerId, "P2");
  await assert.rejects(h.act("undo", { actor: "P1" }), /当前行动玩家/);
  view = await h.act("undo");
  assert.deepEqual(state(h.raw()), state(initial));
  assert.equal(view.pending, null);
  await h.act("redo");
  view = await h.act("redo");
  assert.deepEqual(state(h.raw()), state(accepted));
  assert.equal(view.historyAudit.length, 4);
  await h.act("undo");
  view = await h.act("choose", { accept: false });
  assert.equal(view.history.redoCount, 0);
  assert.equal(view.players[0].resources.seed, 0);
  assert.equal(view.players[1].resources.metal, 0);
  assert.equal(view.players[0].hand[0].uid, "INV");
  assert.ok(
    !judgmentContext(h.raw()).globalEvents.some(
      (e) => e.type === "invitation_accept",
    ),
  );
});

test("world extreme disasters and queued recipient effects are rolled back atomically", async () => {
  const h = await harness(),
    initial = h.raw();
  let view = await h.act("set_world", {
    attributes: { economy: 18, environment: 10, society: 10 },
    reason: "test",
  });
  assert.equal(view.activeDisasters.length, 2);
  while (view.pending) view = await h.act("choose", { resource: "metal" });
  const settled = h.raw(),
    steps = view.history.undoCount;
  assert.equal(
    view.players.reduce((n, p) => n + p.resources.metal, 0),
    3,
  );
  for (let i = 0; i < steps; i++) view = await h.act("undo");
  assert.deepEqual(state(h.raw()), state(initial));
  assert.equal(view.activeDisasters.length, 0);
  assert.ok(
    !judgmentContext(h.raw()).globalEvents.some(
      (e) => e.type === "world_manual",
    ),
  );
  for (let i = 0; i < steps; i++) await h.act("redo");
  assert.deepEqual(state(h.raw()), state(settled));
});

test("flood rollback restores ark roll, personal losses, injuries, draw and round transition", async () => {
  const g = make(2);
  g.round = 3;
  g.turn = 1;
  g.phase = "donate";
  g.ark = { wood: 5, metal: 5, electricity: 5, seed: 0 };
  g.players[0].resources.wood = 1;
  const h = await harness(g),
    before = h.raw();
  let view = await h.act("skip");
  const flooded = h.raw();
  assert.equal(view.pending.kind, "flood");
  while (view.pending) view = await h.act("pay_flood", { resource: "wood" });
  const after = h.raw();
  assert.equal(view.round, 4);
  assert.equal(view.players[1].floodInjury, 1);
  for (let i = 0; i < 3; i++) await h.act("undo");
  assert.deepEqual(state(h.raw()), state(before));
  for (let i = 0; i < 3; i++) await h.act("redo");
  assert.deepEqual(state(h.raw()), state(after));
  for (let i = 0; i < 3; i++) await h.act("undo");
  view = await h.act("skip");
  assert.deepEqual(
    view.events.find((e) => e.type === "flood"),
    flooded.events.find((e) => e.type === "flood"),
  );
  assert.equal(h.raw().rng, flooded.rng);
});

test("undo then replaying technology draws preserves choices/RNG; a new action clears redo", async () => {
  const g = make();
  g.players[0].hand = [{ uid: "TECH", id: "technology" }];
  const h = await harness(g);
  let view = await h.act("play", { cardUid: "TECH" });
  const drawn = h.raw();
  await h.act("undo");
  view = await h.act("play", { cardUid: "TECH" });
  assert.deepEqual(view.pending, drawn.pending);
  assert.equal(h.raw().rng, drawn.rng);
  assert.equal(view.history.redoCount, 0);
  assert.equal(view.historyAudit.at(-1).type, "branch");
  assert.equal(view.historyAudit.at(-1).discarded.length, 1);
  const before = h.raw();
  await assert.rejects(h.act("redo"), /没有可重做/);
  assert.deepEqual(h.raw(), before);
  publicSafe(view);
});

test("history is capped without nested snapshots; undo/redo revisions and audit survive restart", async () => {
  const h = await harness();
  for (let i = 0; i < HISTORY_LIMIT + 5; i++)
    await h.act("set_world", {
      attributes: { economy: 10, environment: 10, society: 10 },
      reason: `edit ${i}`,
    });
  let view = await h.service.get(h.raw().id);
  assert.equal(view.history.undoCount, HISTORY_LIMIT);
  for (const entry of h.raw().historyState.undo) {
    assert.equal(entry.snapshot.historyState, undefined);
    assert.equal(entry.snapshot.historyAudit, undefined);
  }
  for (let i = 0; i < HISTORY_LIMIT; i++) await h.act("undo");
  const undone = h.raw();
  await assert.rejects(h.act("undo"), /没有可撤回/);
  const restarted = createExpeditionService({ store: h.store });
  view = await restarted.get(undone.id);
  assert.equal(view.history.redoCount, HISTORY_LIMIT);
  assert.equal(view.historyAudit.length, HISTORY_LIMIT);
  publicSafe(view);
  const originalRevision = view.revision;
  for (let i = 0; i < HISTORY_LIMIT; i++)
    view = await restarted.action(view.id, {
      type: "redo",
      revision: view.revision,
      actor: view.activePlayerId,
    });
  assert.equal(view.revision, originalRevision + HISTORY_LIMIT);
  assert.equal(view.history.undoCount, HISTORY_LIMIT);
  assert.equal(view.historyAudit.length, HISTORY_LIMIT * 2);
});

test("HTTP duplicate undo is applied once, stale redo and wrong responders cannot mutate storage", async (t) => {
  const local = await testApi();
  t.after(local.close);
  let view = await local.service.create({
    players: [{ characterId: CHARACTERS[0].id, flagId: "P1" }],
  });
  view = await local.service.action(view.id, {
    type: "skip",
    actor: "P1",
    revision: view.revision,
  });
  const url = `${local.base}/api/expeditions/${view.id}/actions`;
  const post = (body) =>
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const input = { type: "undo", actor: "P1", revision: view.revision };
  const responses = await Promise.all([post(input), post(input)]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  view = await local.service.get(view.id);
  assert.equal(view.phase, "cards");
  assert.equal(view.historyAudit.length, 1);
  assert.equal((await post({ ...input, type: "redo" })).status, 409);
  assert.equal(
    (await post({ type: "redo", actor: "P2", revision: view.revision })).status,
    400,
  );
  assert.deepEqual(await local.service.get(view.id), view);
  publicSafe(view);
});

test("write failure leaves both progress and history intact and allows safe retry", async () => {
  const h = await harness();
  await h.act("skip");
  const before = h.raw();
  h.fail(true);
  await assert.rejects(h.act("undo"), /disk unavailable/);
  assert.deepEqual(h.raw(), before);
  h.fail(false);
  await h.act("undo");
  assert.equal(h.raw().historyAudit.length, 1);
});

test("terminal survival can be undone before initial review; all review stages lock evidence", async () => {
  const g = make(2);
  g.round = 8;
  g.turn = 1;
  g.phase = "donate";
  for (const p of g.players) {
    p.position = "0,0";
    p.resources.seed = 2;
    p.floodInjury = 1;
  }
  const seen = [];
  const h = await harness(g, async (game, input) => {
    seen.push(structuredClone(game));
    return {
      verdict: fallbackBoarding(judgmentContext(game)),
      conversations: [
        ...(game.judgment?.conversations || []),
        ...(input.stage === "discussion" ? [{ playerId: input.playerId }] : []),
      ],
    };
  });
  const before = h.raw();
  let view = await h.act("skip");
  assert.equal(view.status, "awaiting_judgment");
  assert.equal(view.players[0].resources.seed, 1);
  const terminal = h.raw();
  await h.act("undo");
  assert.deepEqual(state(h.raw()), state(before));
  await h.act("redo");
  assert.deepEqual(state(h.raw()), state(terminal));
  view = await h.act("judge");
  assert.equal(view.status, "review");
  assert.ok(view.history.lockedReason);
  assert.equal(view.history.undoCount, 0);
  assert.equal(seen[0].historyState, undefined);
  assert.equal(seen[0].historyAudit, undefined);
  assert.deepEqual(seen[0].events, terminal.events);
  const reviewed = h.raw();
  for (const type of ["undo", "redo"])
    await assert.rejects(h.act(type), /审议已开始/);
  assert.deepEqual(h.raw(), reviewed);
  while (view.reviewRemaining.length)
    view = await h.act("discuss", { waive: true });
  view = await h.act("finalize");
  assert.equal(view.status, "finished");
  await assert.rejects(h.act("undo"), /审议已开始/);
  assert.equal(view.historyAudit.length, 2);
});

test("failed judgment preserves terminal checkpoint and redo instead of sealing prematurely", async () => {
  const g = make(1);
  g.round = 8;
  g.phase = "donate";
  g.players[0].position = "0,0";
  const h = await harness(g, () => {
    throw new Error("model failed");
  });
  await h.act("skip");
  const terminal = h.raw();
  await assert.rejects(h.act("judge"), /model failed/);
  assert.deepEqual(h.raw(), terminal);
  const view = await h.act("undo");
  assert.equal(view.status, "playing");
});

test("six-player full game simulation can undo/redo every command without changing gameplay outcome", async () => {
  const h = await harness(make(6));
  let count = 0;
  while (h.raw().status === "playing") {
    const before = h.raw(),
      input = botAction(before);
    await h.act(input.type, input);
    const after = h.raw();
    await h.act("undo");
    assert.deepEqual(state(h.raw()), state(before));
    await h.act("redo");
    assert.deepEqual(state(h.raw()), state(after));
    if (++count > 1500) assert.fail("game did not converge");
  }
  const view = await h.service.get(h.raw().id);
  assert.equal(view.status, "awaiting_judgment");
  assert.equal(view.events.filter((e) => e.type === "flood").length, 3);
  assert.equal(view.historyAudit.length, count * 2);
  assert.equal(view.players.length, 6);
  publicSafe(view);
});
