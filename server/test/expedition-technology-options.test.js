import test from "node:test";
import assert from "node:assert/strict";
import { createGame, command, viewGame } from "../src/expedition/engine.js";
import { CHARACTERS, CARDS } from "../src/expedition/catalog.js";
import { PASSIVE_TECHNOLOGIES } from "../src/expedition/technology-options.js";

const make = () => {
  const game = createGame(
    {
      learningMode: true,
      players: CHARACTERS.slice(0, 3).map((c, i) => ({
        characterId: c.id,
        flagId: `P${i + 1}`,
      })),
    },
    { seed: 11 },
  );
  game.players.forEach((p, i) => {
    p.position = `${i},0`;
    p.resources = { wood: 3, metal: 3, electricity: 3, seed: 3 };
  });
  return game;
};
const act = (g, type, rest = {}) =>
  command(g, {
    type,
    actor: viewGame(g).activePlayerId,
    revision: g.revision,
    ...rest,
  });
const offer = (g, choices) => {
  g.phase = "choice";
  g.pending = { kind: "technology", actor: "P1", choices, resume: "cards" };
  return g;
};

test("all 13 technology capabilities are read-only, cover duplicate passives and immediate constraints", () => {
  const g = offer(
    make(),
    CARDS.technology.map((c) => c.id),
  );
  g.players[0].equipment = [...PASSIVE_TECHNOLOGIES];
  const before = structuredClone(g),
    view = viewGame(g);
  assert.equal(view.technology.choices.length, 13);
  assert.equal(view.technology.equipment.length, 6);
  for (const id of PASSIVE_TECHNOLOGIES)
    assert.match(
      view.technology.choices.find((c) => c.id === id).warning,
      /不叠加/,
    );
  assert.deepEqual(g, before);
});

test("beacon advertises distance, inventory, pending and used-round reasons, then resets next round", () => {
  let g = make();
  const p = g.players[0];
  p.equipment = ["aid-beacon"];
  p.hand = [];
  assert.equal(viewGame(g).trade.beaconBlockedReason, "");
  p.resources = { wood: 0, metal: 0, electricity: 0, seed: 0 };
  assert.match(viewGame(g).trade.beaconBlockedReason, /你没有/);
  p.resources.wood = 1;
  g.players[1].position = "4,0";
  assert.match(viewGame(g).trade.beaconBlockedReason, /附近没有玩家/);
  g.players[1].position = "1,0";
  g.players[1].resources = { wood: 0, metal: 0, electricity: 0, seed: 0 };
  assert.match(viewGame(g).trade.beaconBlockedReason, /附近玩家没有/);
  g.players[1].resources.metal = 1;
  const request = { targetId: "P2", give: { wood: 1 }, receive: { metal: 1 } };
  g = act(g, "beacon", request);
  assert.equal(viewGame(g).trade.response.reason, "");
  g = act(g, "choose", { accept: false });
  assert.equal(viewGame(g).trade.beaconBlockedReason, "");
  g = act(g, "beacon", request);
  g = act(g, "choose", { accept: true });
  assert.match(viewGame(g).trade.beaconBlockedReason, /本回合已完成/);
  assert.equal(g.players[0].resources.metal, 1);
  assert.equal(g.players[1].resources.wood, 1);
  assert.equal(g.players[0].hand.length, 0); // Never requires an invitation.
  while (g.round === 1) g = act(g, "skip");
  if (g.pending?.kind === "public_event")
    g = act(g, "choose", { optionId: g.pending.card.options[0].id });
  assert.equal(viewGame(g).trade.beaconBlockedReason, "");
  assert.deepEqual(g.players[0].roundFlags.noConflictWith, []);
});

test("claw target hints match command rejection and zero-stock draw fallback", () => {
  let g = offer(make(), ["recycling-claw"]);
  g.players[0].roundFlags.noConflictWith = ["P2"];
  let option = viewGame(g).technology.choices[0];
  assert.match(option.blockedReason, /没有可争夺/);
  assert.match(option.targets[0].reason, /互助/);
  assert.match(option.targets[1].reason, /相邻/);
  for (const id of ["P2", "P3"])
    assert.throws(() =>
      act(g, "choose", { techId: "recycling-claw", targetId: id }),
    );
  g.players[0].roundFlags.noConflictWith = [];
  g.players[1].resources = { wood: 0, metal: 0, electricity: 0, seed: 0 };
  option = viewGame(g).technology.choices[0];
  assert.equal(option.blockedReason, "");
  assert.equal(option.targets[0].empty, true);
  const count = g.players[0].hand.length;
  g = act(g, "choose", { techId: "recycling-claw", targetId: "P2" });
  assert.equal(g.players[0].hand.length, count + 1);
});

test("alchemy and empty/full-hand choices explain why benefits require input without altering effects", () => {
  const g = offer(make(), [
    "alchemy-furnace",
    "ruins-blueprint",
    "rapid-prototyper",
  ]);
  g.players[0].resources = { wood: 1, metal: 0, electricity: 0, seed: 0 };
  g.players[0].hand = Array.from({ length: 5 }, (_, i) => ({
    uid: `T${i}`,
    id: "invitation",
  }));
  const choices = viewGame(g).technology.choices;
  assert.match(choices[0].blockedReason, /两份/);
  assert.match(choices[1].warning, /弃牌堆为空/);
  assert.match(choices[2].warning, /手牌已满/);
  assert.equal(choices[1].blockedReason, "");
});

test("nested technology offers have stable distinct source IDs and restore the original selection", () => {
  let g = make();
  g.players[0].hand = [
    { uid: "first-tech", id: "technology" },
    { uid: "second-tech", id: "technology" },
  ];
  g = act(g, "play", { cardUid: "first-tech" });
  const original = structuredClone(g.pending);
  assert.equal(original.sourceCardUid, "first-tech");
  g = act(g, "play", { cardUid: "second-tech" });
  assert.equal(g.pending.sourceCardUid, "second-tech");
  assert.notEqual(g.pending.offerId, original.offerId);
  g = act(g, "choose", { decline: true });
  assert.deepEqual(g.pending, original);
});

test("nested blueprints cannot duplicate a recovered card or delete an unrelated discard", () => {
  let g = make();
  g.players[0].hand = [{ uid: "nested-tech", id: "technology" }];
  const original = { uid: "recover-once", id: "invitation" };
  g.discard = [original];
  g.phase = "choice";
  g.pending = {
    kind: "recover",
    actor: "P1",
    choices: [structuredClone(original)],
    resume: "cards",
  };
  g = act(g, "play", { cardUid: "nested-tech" });
  g.pending.choices = ["ruins-blueprint"]; // Deterministic test-only draw.
  g = act(g, "choose", { techId: "ruins-blueprint" });
  g = act(g, "choose", { cardUid: original.uid });
  assert.equal(g.pending, null);
  assert.equal(g.phase, "cards");
  assert.deepEqual(g.players[0].hand, [original]);
  assert.deepEqual(g.discard, [{ uid: "nested-tech", id: "technology" }]);
  assert.ok(g.events.some((e) => e.type === "recover_unavailable"));
});

test("stale saved blueprint choices reject phantom cards, expose valid alternatives and can close an empty offer", () => {
  let g = make();
  const missing = { uid: "missing", id: "invitation" },
    valid = { uid: "valid", id: "technology" };
  g.players[0].hand = [];
  g.discard = [valid];
  g.phase = "choice";
  g.pending = {
    kind: "recover",
    actor: "P1",
    choices: [missing, valid],
    resume: "cards",
  };
  const before = structuredClone(g);
  assert.deepEqual(viewGame(g).pending.choices, [valid]);
  assert.throws(() => act(g, "choose", { cardUid: "missing" }), /已不在弃牌堆/);
  assert.deepEqual(g, before);
  g.pending.choices = [missing];
  assert.throws(
    () => act(g, "choose", { cardUid: "missing" }),
    /确认无可回收牌/,
  );
  g = act(g, "choose", { decline: true });
  assert.equal(g.pending, null);
  assert.deepEqual(g.players[0].hand, []);
  assert.deepEqual(g.discard, [valid]);
});
