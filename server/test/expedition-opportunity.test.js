import test from "node:test";
import assert from "node:assert/strict";
import { buildOpportunityContext } from "../src/expedition/opportunity-context.js";
import { FLAGS, TILES, reachable } from "../src/expedition/map.js";

const input = {
  players: FLAGS.map((flag, i) => ({ id: `P${i + 1}`, spawn: flag.id })),
};

test("spawn context is deterministic, non-mutating and describes actual map asymmetry without assigning scores", () => {
  const before = structuredClone(input),
    mapBefore = structuredClone(TILES);
  const context = buildOpportunityContext(input);
  assert.deepEqual(context, buildOpportunityContext(input));
  assert.deepEqual(input, before);
  assert.deepEqual(TILES, mapBefore);
  assert.match(context.mapHash, /^[0-9a-f]{64}$/);
  assert.match(context.limitations, /不是努力、能力或道德分/);
  assert.deepEqual(
    context.players.map((p) => p.minimumStepsToSafeZone),
    [11, 12, 12, 11, 12, 12],
  );
  assert.equal(context.players[0].resourceTilesWithinTwoSteps, 3);
  assert.equal(context.players[1].resourceTilesWithinTwoSteps, 0);
  for (const player of context.players) {
    const reachableIds = new Set(
      Object.keys(reachable(player.initialTileId, 2, 0)),
    );
    assert.equal(
      player.resourceTilesWithinTwoSteps,
      TILES.filter((tile) => reachableIds.has(tile.id) && tile.resource).length,
    );
    assert.equal(player.score, undefined);
  }
  context.players[0].resourceTypesWithinTwoSteps.push("invented");
  assert.ok(
    !buildOpportunityContext(
      input,
    ).players[0].resourceTypesWithinTwoSteps.includes("invented"),
  );
});

test("opportunity follows the actual flag, not player id; missing flags remain unknown", () => {
  const shifted = buildOpportunityContext({
    players: [
      { id: "P1", spawn: "P2" },
      { id: "P2", spawn: "P1" },
      { id: "unknown", spawn: "missing" },
    ],
  });
  assert.equal(shifted.players[0].minimumStepsToSafeZone, 12);
  assert.equal(shifted.players[0].resourceTilesWithinTwoSteps, 0);
  assert.equal(shifted.players[1].minimumStepsToSafeZone, 11);
  assert.deepEqual(shifted.players[2], {
    playerId: "unknown",
    flagId: "missing",
    available: false,
  });
});
