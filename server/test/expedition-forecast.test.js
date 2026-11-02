import test from "node:test";
import assert from "node:assert/strict";
import { buildFloodForecast } from "../src/expedition/forecast.js";
import { createGame, command, floodCost } from "../src/expedition/engine.js";
import { CHARACTERS, RESOURCES } from "../src/expedition/catalog.js";

function make(n = 3) {
  return createGame(
    {
      players: CHARACTERS.slice(0, n).map((c, i) => ({
        characterId: c.id,
        flagId: `P${i + 1}`,
      })),
    },
    { seed: 11 },
  );
}

test("forecasts each scheduled flood without inspecting RNG or modifying state", () => {
  const g = make();
  const before = structuredClone(g);
  const expected = [
    [1, 0, 3, 1, 2],
    [3, 0, 3, 1, 0],
    [4, 1, 5, 2, 1],
    [5, 1, 5, 2, 0],
    [6, 2, 7, 3, 1],
    [7, 2, 7, 3, 0],
  ];
  for (const [round, floodLevel, nextRound, level, roundsUntil] of expected) {
    const state = { ...g, round, floodLevel };
    Object.defineProperty(state, "rng", {
      get() {
        throw Error("The forecast must not inspect hidden RNG");
      },
    });
    const result = buildFloodForecast(state, floodCost);
    assert.equal(result.next.round, nextRound);
    assert.equal(result.next.level, level);
    assert.equal(result.next.zone, 4 - level);
    assert.equal(result.next.roundsUntil, roundsUntil);
    assert.equal(result.next.baseCost.mandatory.seed, level >= 2 ? 1 : 0);
    assert.equal(
      result.next.baseCost.mandatory.electricity,
      level === 3 ? 1 : 0,
    );
  }
  assert.deepEqual(g, before);
});

test("shows only public die possibilities, actual stock caps and possible capacity loss", () => {
  const g = make();
  g.round = 6;
  g.floodLevel = 2;
  g.ark = { wood: 0, metal: 1, electricity: 3, seed: 13 };
  const next = buildFloodForecast(g, floodCost).next;
  assert.equal(next.ark.requested, 3);
  assert.deepEqual(
    next.ark.possibilities.map((row) => [
      row.resource,
      row.dieValues,
      row.actualLoss,
      row.seatsAfter,
    ]),
    [
      ["wood", [1, 2], 0, 1],
      ["metal", [3, 4], 1, 0],
      ["electricity", [5, 6], 3, 0],
    ],
  );
  assert.equal("die" in next.ark, false);
});

test("already triggered flood is not forecast again, including interrupted choices and final flood", () => {
  const g = make();
  g.round = 3;
  g.floodLevel = 1;
  g.phase = "disaster";
  g.events.push(
    {
      seq: 50,
      round: 3,
      type: "flood",
      die: 4,
      resource: "metal",
      requested: 1,
      actual: 0,
      zone: 3,
    },
    { seq: 51, round: 3, type: "flood_payment", actor: "P1" },
  );
  const result = buildFloodForecast(g, floodCost);
  assert.equal(result.next.round, 5);
  assert.equal(result.current.actual, 0);
  assert.deepEqual(result.current.paidPlayerIds, ["P1"]);
  assert.deepEqual(result.current.remainingPlayerIds, ["P2", "P3"]);
  g.round = 7;
  g.floodLevel = 3;
  g.events.push({
    seq: 52,
    round: 7,
    type: "flood",
    die: 1,
    resource: "wood",
    requested: 3,
    actual: 2,
    zone: 1,
  });
  const finalFlood = buildFloodForecast(g, floodCost);
  assert.equal(finalFlood.next, null);
  assert.equal(finalFlood.current.round, 7);
  g.round = 8;
  assert.deepEqual(buildFloodForecast(g, floodCost), {
    current: null,
    next: null,
  });
  g.status = "awaiting_judgment";
  g.round = 1;
  assert.equal(buildFloodForecast(g, floodCost).next, null);
});

test("personal reserve-crate discounts and injury forecasts match real settlements across resource combinations", () => {
  // 2 equipment states × 3 floods × 32 inventories = 192 real settlements.
  for (const protectedPlayer of [false, true]) {
    for (let level = 1; level <= 3; level++) {
      for (let mask = 0; mask < 32; mask++) {
        const g = make(2);
        g.round = [3, 5, 7][level - 1];
        g.floodLevel = level - 1;
        const p = g.players[0];
        p.equipment = protectedPlayer ? ["reserve-crate"] : [];
        p.resources = Object.fromEntries(
          RESOURCES.map((resource, i) => [resource, (mask >> i) % 3]),
        );
        const preview = buildFloodForecast(g, floodCost).next.players[0];
        g.floodLevel = level;
        g.phase = "flood";
        g.pending = { kind: "flood", actor: p.id, index: 0 };
        assert.deepEqual(preview.cost, floodCost(g, p));
        const result = command(g, {
          type: "pay_flood",
          actor: p.id,
          revision: g.revision,
          resource: preview.eligibleOptions[0],
        });
        const payment = result.events.findLast(
          (e) => e.type === "flood_payment",
        );
        assert.equal(payment.injury, preview.injuryIfPaid);
        assert.equal(preview.protected, protectedPlayer);
      }
    }
  }
});
