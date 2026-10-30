import test from "node:test";
import assert from "node:assert/strict";
import {
  createGame,
  command,
  activePlayer,
  viewGame,
} from "../src/expedition/engine.js";
import { CHARACTERS } from "../src/expedition/catalog.js";
import {
  PUBLIC_EVENTS,
  beginPublicEvent,
} from "../src/expedition/public-events.js";
import { botAction, simulate } from "../src/expedition/simulation.js";
import { recordAction, restoreHistory } from "../src/expedition/history.js";
import {
  changeWorld,
  syncDisasters,
  pumpDisasters,
} from "../src/expedition/world.js";

const make = (seed = 11, learningMode = true) =>
  createGame(
    {
      learningMode,
      players: CHARACTERS.slice(0, 6).map((character, index) => ({
        characterId: character.id,
        flagId: `P${index + 1}`,
      })),
    },
    { seed },
  );
const input = (g, type, other = {}) => ({
  type,
  actor: activePlayer(g).id,
  revision: g.revision,
  ...other,
});
const act = (g, type, other = {}) => command(g, input(g, type, other));
const tracked = (g, type, other = {}) => {
  const request = input(g, type, other);
  return recordAction(g, command(g, request), request);
};
const restore = (g, type) => restoreHistory(g, input(g, type));
function beforeRoundTwo(seed = 11) {
  const g = make(seed);
  g.turn = 5;
  g.phase = "donate";
  return g;
}
function offer(cardId) {
  const g = act(beforeRoundTwo(), "skip");
  if (cardId)
    g.pending.card = structuredClone(
      PUBLIC_EVENTS.cards.find((card) => card.id === cardId),
    );
  return g;
}

test("v2 events are opt-in for new games; legacy and existing learning-v1 games are unchanged", () => {
  const old = make(11, false);
  assert.equal(old.publicEvents, undefined);
  const v1 = make();
  delete v1.publicEvents;
  v1.learningVersion = "student-learning-v1";
  for (const g of [old, v1]) {
    g.turn = 5;
    g.phase = "donate";
    const next = act(g, "skip");
    assert.equal(next.round, 2);
    assert.equal(next.phase, "cards");
    assert.equal(next.pending, null);
    assert.equal(next.publicEvents, undefined);
  }
});

test("exactly three different public events occur at rounds 2,4,6 with rotating deciders", () => {
  const first = simulate({
    seed: 41,
    learningMode: true,
    policy: "mixed",
  }).game;
  const again = simulate({
    seed: 41,
    learningMode: true,
    policy: "mixed",
  }).game;
  assert.deepEqual(first, again);
  const offers = first.events.filter(
    (event) => event.type === "public_event_offer",
  );
  assert.deepEqual(
    offers.map((event) => event.round),
    [2, 4, 6],
  );
  assert.equal(new Set(offers.map((event) => event.cardId)).size, 3);
  assert.equal(first.publicEvents.choices.length, 3);
  assert.equal(first.publicEvents.remaining.length, 3);
  const start = first.players.findIndex(
    (p) => p.id === first.publicEvents.startingDeciderId,
  );
  assert.deepEqual(
    offers.map((event) => event.decisionActor),
    [0, 1, 2].map((offset) => first.players[(start + offset) % 6].id),
  );
  assert.ok(
    new Set(
      Array.from(
        { length: 20 },
        (_, seed) => make(seed + 1).publicEvents.startingDeciderId,
      ),
    ).size >= 4,
  );
});

test("event RNG never consumes the card/flood stream and read-only views expose no future random state", () => {
  const old = make(23, false),
    current = make(23);
  assert.equal(current.rng, old.rng);
  const before = beforeRoundTwo(23),
    withoutEvents = structuredClone(before);
  delete withoutEvents.publicEvents;
  const eventGame = act(before, "skip"),
    plain = act(withoutEvents, "skip");
  assert.equal(eventGame.rng, plain.rng);
  assert.deepEqual(
    eventGame.players.map((p) => p.hand),
    plain.players.map((p) => p.hand),
  );
  const frozen = structuredClone(eventGame);
  const view = viewGame(eventGame);
  assert.equal(view.rng, undefined);
  assert.equal(view.publicEvents.rng, undefined);
  assert.equal(view.publicEvents.remaining, undefined);
  assert.equal(view.publicEvents.catalogSnapshot, undefined);
  assert.deepEqual(view.publicEvents.rounds, [2, 4, 6]);
  assert.equal(view.activePlayerId, eventGame.pending.actor);
  view.pending.card.title = "changed only on client";
  view.publicEvents.offeredRounds.push(99);
  assert.deepEqual(eventGame, frozen);
  assert.equal(beginPublicEvent(eventGame), false);
  assert.deepEqual(eventGame, frozen);
});

test("event choices reject stale/wrong actor/unknown option/other actions and never partially mutate", () => {
  const g = offer(),
    frozen = structuredClone(g);
  for (const request of [
    input(g, "choose", { optionId: "invented" }),
    input(g, "choose", {
      optionId: "salvage",
      actor: g.players.find((p) => p.id !== g.pending.actor).id,
    }),
    input(g, "choose", { optionId: "salvage", revision: g.revision - 1 }),
    input(g, "choose", { optionId: "salvage", reason: 123 }),
    input(g, "choose", { optionId: "salvage", reason: "x".repeat(501) }),
    input(g, "skip"),
    input(g, "move", { tileId: "0,0" }),
    input(g, "set_world", {
      attributes: { economy: 10, environment: 10, society: 10 },
      reason: "cannot bypass",
    }),
  ]) {
    assert.throws(() => command(g, request));
    assert.deepEqual(g, frozen);
  }
  g.players
    .find((p) => p.id === g.pending.actor)
    .hand.push({ id: "technology", uid: "must-not-interrupt" });
  assert.throws(
    () => act(g, "play", { cardUid: "must-not-interrupt" }),
    /公共事件/,
  );
});

test("all six cards apply explicit public gains/costs without crediting private donations or world impact", () => {
  for (const card of PUBLIC_EVENTS.cards)
    for (const option of card.options) {
      const g = offer(card.id),
        rng = g.rng,
        beforePlayers = structuredClone(g.players);
      const next = act(g, "choose", {
        optionId: option.id,
        reason: "课堂共同决定",
      });
      assert.equal(next.phase, "cards");
      assert.equal(next.pending, null);
      assert.equal(next.turn, 0);
      assert.equal(next.rng, rng);
      assert.deepEqual(next.players, beforePlayers);
      for (const [resource, amount] of Object.entries(next.ark))
        assert.equal(amount, option.effects.ark[resource] || 0);
      for (const dimension of ["economy", "environment", "society"])
        assert.equal(
          next.attributes[dimension],
          10 + (option.effects.world[dimension] || 0),
        );
      assert.deepEqual(next.donations, []);
      const chosen = next.events.find(
        (event) => event.type === "public_event_choice",
      );
      assert.equal(chosen.decisionActor, g.pending.actor);
      assert.equal(chosen.reason, "课堂共同决定");
      if (Object.keys(option.effects.world).length) {
        const world = next.events.find(
          (event) => event.seq === chosen.worldChangeEventSeq,
        );
        assert.equal(world.actor, "system");
        assert.equal(world.cause.type, "public_event");
        assert.equal(world.cause.cardId, card.id);
      } else assert.equal(chosen.worldChangeEventSeq, null);
    }
});

test("world lower bound is logged as actual zero, not an invented environmental loss", () => {
  const g = offer("sealed-warehouse");
  g.world.base.environment = 1;
  g.attributes.environment = 1;
  const next = act(g, "choose", { optionId: "salvage" });
  const chosen = next.events.find(
    (event) => event.type === "public_event_choice",
  );
  assert.equal(chosen.requestedEffects.world.environment, -1);
  assert.equal(chosen.actualEffects.world.environment, 0);
  assert.equal(next.ark.metal, 2);
});

test("event-caused disaster settles first and resumes normal cards, not a second event choice", () => {
  const g = offer("shared-energy");
  g.world.base.society = 13;
  g.attributes.society = 13;
  let next = act(g, "choose", { optionId: "restore" });
  assert.equal(next.pending.kind, "disaster_gain");
  assert.equal(next.publicEvents.choices.length, 1);
  while (next.pending?.kind.startsWith("disaster_"))
    next = command(next, botAction(next));
  assert.equal(next.phase, "cards");
  assert.equal(next.pending, null);
  assert.equal(next.turn, 0);
  assert.equal(next.publicEvents.choices.length, 1);
});

test("a suspended public event is restored after an intervening disaster", () => {
  const g = offer("driftwood-habitat");
  const before = structuredClone(g.pending);
  changeWorld(g, { economy: 4 }, { source: "test interruption" });
  syncDisasters(g);
  pumpDisasters(g);
  assert.equal(g.pending.kind, "disaster_gain");
  let next = g;
  while (next.pending?.kind.startsWith("disaster_"))
    next = command(next, botAction(next));
  assert.deepEqual(next.pending, before);
  next = act(next, "choose", { optionId: "restore" });
  assert.equal(next.publicEvents.choices.length, 1);
  assert.equal(next.phase, "cards");
});

test("undo/redo restores event draw, choice and both random streams without reroll farming", () => {
  const before = beforeRoundTwo(7);
  const offered = tracked(before, "skip");
  const firstCard = offered.pending.card.id;
  const eventRng = offered.publicEvents.rng;
  const undone = restore(offered, "undo");
  assert.equal(undone.publicEvents.rng, before.publicEvents.rng);
  assert.equal(undone.rng, before.rng);
  const offeredAgain = tracked(undone, "skip");
  assert.equal(offeredAgain.pending.card.id, firstCard);
  assert.equal(offeredAgain.publicEvents.rng, eventRng);
  const selected = tracked(offeredAgain, "choose", { optionId: "salvage" });
  const reversed = restore(selected, "undo");
  assert.equal(reversed.pending.card.id, firstCard);
  assert.equal(reversed.publicEvents.choices.length, 0);
  assert.equal(reversed.publicEvents.rng, selected.publicEvents.rng);
  const redone = restore(reversed, "redo");
  assert.deepEqual(redone.publicEvents, selected.publicEvents);
  assert.deepEqual(redone.ark, selected.ark);
  assert.deepEqual(redone.events, selected.events);
});

test("flag-offset diagnostic is explicit, validated and preserves the ordinary default", () => {
  assert.throws(() => simulate({ flagOffset: -1 }), /flagOffset/);
  assert.throws(() => simulate({ flagOffset: 6 }), /flagOffset/);
  const { game } = simulate({ seed: 3, players: 2, flagOffset: 1 });
  assert.deepEqual(
    game.players.map((player) => player.spawn),
    ["P2", "P3"],
  );
  assert.equal(game.publicEvents, undefined);
});
