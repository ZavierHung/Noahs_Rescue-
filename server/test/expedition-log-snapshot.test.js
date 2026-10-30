import test from "node:test";
import assert from "node:assert/strict";
import { createGame, command, activePlayer } from "../src/expedition/engine.js";
import { CHARACTERS } from "../src/expedition/catalog.js";
import { botAction, simulate } from "../src/expedition/simulation.js";

const make = (players = 3, seed = 11) =>
  createGame(
    {
      players: CHARACTERS.slice(0, players).map((character, i) => ({
        characterId: character.id,
        flagId: `P${i + 1}`,
      })),
    },
    { seed },
  );
const act = (game, type, data = {}) =>
  command(game, {
    actor: activePlayer(game).id,
    revision: game.revision,
    type,
    ...data,
  });

test("later equipment must not appear in an earlier action snapshot", () => {
  let game = act(make(), "skip");
  const priorEvents = JSON.stringify(game.events);
  const count = game.events.length;
  game.phase = "choice";
  game.pending = {
    kind: "technology",
    actor: "P1",
    choices: ["space-ring", "space-ring"],
    resume: "cards",
  };
  game = act(game, "choose", { techId: "space-ring" });
  assert.ok(game.players[0].equipment.includes("space-ring"));
  assert.equal(JSON.stringify(game.events.slice(0, count)), priorEvents);
  const earlierAction = game.events.find((event) => event.type === "action");
  assert.deepEqual(earlierAction.effects[0].equipment, []);
  const technology = game.events.find((event) => event.type === "technology");
  const equippedAction = game.events.find(
    (event) => event.type === "action" && event.seq > technology.seq,
  );
  assert.deepEqual(equippedAction.effects[0].equipment, ["space-ring"]);
});

test("creation, command arguments, donation records and live cards never alias event data", () => {
  let game = make();
  const creation = JSON.stringify(game.events);
  game.rules.baseMove += 1;
  game.players[0].hand[0].id = "technology";
  assert.equal(JSON.stringify(game.events), creation);
  game.phase = "donate";
  game.players[0].resources.wood = 2;
  const input = {
    actor: "P1",
    revision: game.revision,
    type: "donate",
    amounts: { wood: 1 },
  };
  game = command(game, input);
  const donated = JSON.stringify(game.events);
  input.amounts.wood = 99;
  game.donations[0].amounts.wood = 77;
  game.players[0].equipment.push("space-ring");
  assert.equal(JSON.stringify(game.events), donated);
});

test("technology draw choices and disaster removed-card records are detached snapshots", () => {
  let game = make();
  game.players[0].hand = [{ uid: "C-test-tech", id: "technology" }];
  game = act(game, "play", { cardUid: "C-test-tech" });
  const choices = JSON.stringify(game.events);
  game.pending.choices.push("space-ring");
  assert.equal(JSON.stringify(game.events), choices);

  let disaster = make();
  disaster.players[0].hand = [{ uid: "C-test-confiscated", id: "technology" }];
  disaster = act(disaster, "set_world", {
    attributes: { economy: 1, environment: 10, society: 10 },
    reason: "isolated log snapshot regression",
  });
  const removed = disaster.events.find(
    (event) => event.type === "disaster_hand_loss" && event.actor === "P1",
  );
  assert.equal(removed.removed[0].uid, "C-test-confiscated");
  const events = JSON.stringify(disaster.events);
  disaster.discard.find((card) => card.uid === "C-test-confiscated").id =
    "invitation";
  assert.equal(JSON.stringify(disaster.events), events);
});

test("seed 41 keeps the event prefix immutable at every step and equipment follows its actual technology event", () => {
  let game = make(6, 41);
  let commands = 0;
  while (game.status === "playing") {
    assert.ok(++commands <= 2500, "simulation must converge");
    const prior = JSON.stringify(game.events);
    const count = game.events.length;
    game = command(game, botAction(game, { seed: 41 }));
    assert.equal(
      JSON.stringify(game.events.slice(0, count)),
      prior,
      `earlier event mutated at command ${commands}`,
    );
  }
  const firstAction = game.events.find((event) => event.type === "action");
  assert.equal(firstAction.seq, 9);
  assert.equal(firstAction.round, 1);
  assert.deepEqual(
    firstAction.effects.find((effect) => effect.playerId === "P1").equipment,
    [],
  );
  const acquired = game.events.find(
    (event) =>
      event.type === "technology" &&
      event.actor === "P1" &&
      event.cardId === "space-ring",
  );
  assert.ok(acquired, "the reported later space-ring event must occur");
  assert.equal(acquired.round, 5);
  for (const event of game.events.filter(
    (event) => event.type === "action" && event.seq < acquired.seq,
  )) {
    assert.equal(
      event.effects
        .find((effect) => effect.playerId === "P1")
        .equipment.includes("space-ring"),
      false,
    );
  }
  const replay = simulate({ seed: 41, players: 6 });
  assert.equal(replay.commands, commands);
  assert.deepEqual(replay.game, game);
});
