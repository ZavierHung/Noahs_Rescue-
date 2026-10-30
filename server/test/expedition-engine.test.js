import test from "node:test";
import assert from "node:assert/strict";
import {
  createGame,
  command,
  viewGame,
  floodCost,
  bag,
} from "../src/expedition/engine.js";
import { CHARACTERS, CARDS, RESOURCES } from "../src/expedition/catalog.js";
import {
  TILES,
  FLAGS,
  neighbors,
  tileById,
  distance,
  reachable,
  flooded,
} from "../src/expedition/map.js";
import { simulate } from "../src/expedition/simulation.js";
const make = (n = 2) =>
  createGame(
    {
      players: CHARACTERS.slice(0, n).map((c, i) => ({
        characterId: c.id,
        flagId: `P${i + 1}`,
      })),
    },
    { seed: 11 },
  );
const act = (g, type, data = {}) =>
  command(g, {
    revision: g.revision,
    actor: viewGame(g).activePlayerId,
    type,
    ...data,
  });
function tech(id, n = 2) {
  const g = make(n);
  g.phase = "choice";
  g.pending = {
    kind: "technology",
    actor: "P1",
    choices: [id, id],
    resume: "cards",
  };
  g.players.forEach((p) => {
    p.position = "0,0";
    p.resources = { wood: 3, metal: 3, electricity: 3, seed: 3 };
  });
  g.players[1] && (g.players[1].position = "1,0");
  return g;
}

test("unique characters and flags; 1–6 players; initial resources and hand count", () => {
  const g = make(6);
  assert.equal(g.players.length, 6);
  assert.equal(new Set(g.players.map((p) => p.position)).size, 6);
  g.players.forEach((p) => {
    assert.deepEqual(p.resources, bag());
    assert.equal(p.hand.length, 1);
  });
  assert.throws(() => createGame({ players: [] }), /1—6/);
  assert.throws(
    () =>
      createGame({
        players: [
          { characterId: CHARACTERS[0].id, flagId: "P1" },
          { characterId: CHARACTERS[0].id, flagId: "P2" },
        ],
      }),
    /不能重复/,
  );
  assert.throws(
    () =>
      createGame({
        players: [{ characterId: CHARACTERS[0].id, flagId: "P1" }],
        seats: 2,
      }),
    /席位/,
  );
});
test("regular axial hex neighbors, six flag routes, resource calibration and flood rings", () => {
  assert.equal(neighbors(tileById("0,0")).length, 6);
  for (const tile of neighbors(tileById("0,0")))
    assert.equal(distance(tile, tileById("0,0")), 1);
  for (const flag of FLAGS) {
    assert.equal(tileById(flag.tileId).zone, 3);
    assert.ok(Object.keys(reachable(flag.tileId, 2, 0)).length > 1);
  }
  assert.deepEqual(
    new Set(TILES.filter((t) => t.resource).map((t) => t.resource)),
    new Set(RESOURCES),
  );
  assert.equal(flooded({ zone: 3 }, 1), true);
  assert.equal(flooded({ zone: 2 }, 1), false);
  assert.equal(flooded({ zone: 1 }, 3), true);
  assert.equal(flooded({ zone: 0 }, 3), false);
});
test("stage order, actor and revision validation; rejected commands do not mutate inputs", () => {
  const g = make(),
    snapshot = structuredClone(g);
  assert.throws(() => act(g, "gather"), /尚未进入/);
  assert.throws(() => act(g, "skip", { actor: "P2" }), /当前行动/);
  assert.throws(() => act(g, "skip", { revision: 0 }), /刷新/);
  assert.deepEqual(g, snapshot);
  let next = act(g, "skip");
  assert.equal(next.phase, "move");
  assert.throws(() => act(next, "move", { tileId: "0,0" }), /0—2/);
  next = act(next, "move", { tileId: next.players[0].position });
  assert.equal(next.phase, "gather");
  next = act(next, "skip");
  assert.equal(next.phase, "donate");
  next = act(next, "skip");
  assert.equal(next.turn, 1);
});
test("gather belongs to individual, once per round; blank and flooded tiles reject collection", () => {
  const g = make();
  g.phase = "gather";
  const tile = TILES.find((t) => t.resource === "wood" && t.zone === 3);
  g.players[0].position = tile.id;
  const collected = act(g, "gather");
  assert.equal(collected.players[0].resources.wood, 1);
  assert.equal(collected.players[1].resources.wood, 0);
  assert.throws(() => act(collected, "gather"), /已经采集/);
  g.floodLevel = 1;
  assert.throws(() => act(g, "gather"), /淹没/);
  g.floodLevel = 0;
  g.players[0].position = "0,0";
  assert.throws(() => act(g, "gather"), /没有可采集/);
});
test("donation is atomic, logs exact resources and rejects overdrafts/negative values", () => {
  const g = make();
  g.phase = "donate";
  g.players[0].resources.wood = 2;
  assert.throws(() => act(g, "donate", { amounts: { wood: 3 } }), /不足/);
  assert.throws(() => act(g, "donate", { amounts: { wood: -1 } }), /非负/);
  const next = act(g, "donate", { amounts: { wood: 2 } });
  assert.equal(next.ark.wood, 2);
  assert.equal(next.players[0].resources.wood, 0);
  assert.equal(next.players[0].donated.wood, 2);
  assert.equal(next.donations.length, 1);
  assert.equal(next.donations[0].amounts.wood, 2);
  assert.equal(next.events.find((e) => e.type === "donation").actor, "P1");
});
test("invitation rejection permits retry; acceptance creates one independently selected resource each", () => {
  let g = make();
  g.players[0].position = "0,0";
  g.players[1].position = "1,0";
  g.players[0].resources.wood = 2;
  g.players[1].resources.metal = 1;
  g.players[0].hand = [{ uid: "trade", id: "invitation" }];
  g = act(g, "play", {
    cardUid: "trade",
    targetId: "P2",
    resource: "metal",
  });
  assert.equal(viewGame(g).activePlayerId, "P2");
  g = act(g, "choose", { accept: false });
  assert.equal(g.players[0].hand.length, 1);
  g = act(g, "play", {
    cardUid: "trade",
    targetId: "P2",
    resource: "metal",
  });
  g = act(g, "choose", { accept: true, resource: "wood" });
  assert.equal(g.players[0].resources.metal, 1);
  assert.equal(g.players[1].resources.wood, 1);
  assert.equal(g.players[0].resources.wood, 2);
  assert.equal(g.players[1].resources.metal, 1);
  assert.equal(g.players[0].hand.length, 0);
});
test("beacon trade view exposes contact and acceptance reasons without writes, and uses the same acceptance validation", () => {
  let g = make();
  g.players[0].position = "0,0";
  g.players[1].position = "1,0";
  g.players[0].resources.wood = 2;
  g.players[1].resources.metal = 1;
  g.players[0].hand = [{ uid: "trade", id: "invitation" }];
  g.players[0].equipment = ["aid-beacon"];
  const snapshot = structuredClone(g);
  assert.deepEqual(viewGame(g).trade.targets[0], {
    playerId: "P2",
    distance: 1,
    contact: true,
  });
  assert.deepEqual(g, snapshot);
  g = act(g, "beacon", {
    cardUid: "trade",
    targetId: "P2",
    give: { wood: 1 },
    receive: { metal: 1 },
  });
  assert.equal(viewGame(g).trade.response.reason, "");
  assert.ok(
    g.events.some((e) => e.type === "trade_offer" && e.targetId === "P2"),
  );
  g.players[1].resources.metal = 0;
  assert.match(viewGame(g).trade.response.reason, /资源不足/);
  assert.throws(() => act(g, "choose", { accept: true }), /资源不足/);
  g = act(g, "choose", { accept: false });
  assert.equal(g.players[0].hand[0].uid, "trade");
  g.players[0].roundFlags.noInvite = true;
  assert.match(viewGame(g).trade.invitationBlockedReason, /炼金炉/);
  g.players[1].position = "3,0";
  assert.equal(viewGame(g).trade.targets[0].contact, false);
});
test("action draw is equiprobable with replacement and technology offers two independent choices", () => {
  let technology = 0,
    invitation = 0;
  for (let seed = 1; seed <= 4000; seed++) {
    const g = createGame(
      { players: [{ characterId: CHARACTERS[0].id, flagId: "P1" }] },
      { seed },
    );
    g.players[0].hand[0].id === "technology" ? technology++ : invitation++;
  }
  assert.ok(Math.abs(technology - invitation) < 700);
  let g = make();
  g.players[0].hand = [{ uid: "t", id: "technology" }];
  g = act(g, "play", { cardUid: "t" });
  assert.equal(g.pending.choices.length, 2);
  assert.equal(g.players[0].hand.length, 0);
  assert.ok(
    g.pending.choices.every((id) => CARDS.technology.some((c) => c.id === id)),
  );
  g = act(g, "choose", { decline: true });
  assert.equal(g.phase, "cards");
  assert.equal(g.pending, null);
});
test("persistent tech: hand8, move+1, gather+1, no stacking; full status changes", () => {
  for (const id of [
    "space-ring",
    "skateboard-shoes",
    "mining-drone",
    "reserve-crate",
    "aid-beacon",
    "famed-blade",
  ]) {
    let g = tech(id);
    const expected = CARDS.technology.find((c) => c.id === id).status;
    g = act(g, "choose", { techId: id });
    assert.ok(g.players[0].equipment.includes(id));
    for (const [k, d] of Object.entries(expected))
      assert.equal(g.attributes[k], 10 + d);
    const scores = { ...g.attributes };
    g.pending = {
      kind: "technology",
      actor: "P1",
      choices: [id, id],
      resume: "cards",
    };
    g.phase = "choice";
    g = act(g, "choose", { techId: id });
    assert.deepEqual(g.attributes, scores);
    if (id === "skateboard-shoes") {
      g.phase = "move";
      assert.ok(
        Object.values(viewGame(g).reachable).some((p) => p.length === 3),
      );
    }
    if (id === "mining-drone") {
      g.phase = "gather";
      g.players[0].position = TILES.find(
        (t) => t.resource === "metal" && t.zone === 1,
      ).id;
      g = act(g, "gather");
      assert.equal(g.players[0].resources.metal, 5);
    }
  }
});
test("alchemy consumes exactly two and produces three matching resources; blocks invitation", () => {
  const original = tech("alchemy-furnace");
  assert.throws(
    () =>
      act(original, "choose", {
        techId: "alchemy-furnace",
        spend: { wood: 1 },
        resource: "seed",
      }),
    /两份/,
  );
  const g = act(original, "choose", {
    techId: "alchemy-furnace",
    spend: { wood: 1, metal: 1 },
    resource: "seed",
  });
  assert.equal(g.players[0].resources.seed, 6);
  assert.equal(g.players[0].resources.wood, 2);
  assert.equal(g.players[0].roundFlags.noInvite, true);
});
test("beacon trades one each once per round and prevents same-target conflict", () => {
  let g = act(tech("aid-beacon"), "choose", { techId: "aid-beacon" });
  g = act(g, "beacon", {
    targetId: "P2",
    give: { wood: 1 },
    receive: { metal: 1 },
  });
  g = act(g, "choose", { accept: true });
  assert.throws(
    () =>
      act(g, "beacon", {
        targetId: "P2",
        give: { wood: 1 },
        receive: { metal: 1 },
      }),
    /不可用/,
  );
  g.phase = "choice";
  g.pending = {
    kind: "technology",
    actor: "P1",
    choices: ["recycling-claw"],
    resume: "cards",
  };
  assert.throws(
    () => act(g, "choose", { techId: "recycling-claw", targetId: "P2" }),
    /不能争夺/,
  );
});
test("shared supplies draft playerCount+1 in order, one each, surplus is discarded", () => {
  let g = act(tech("shared-supply-pod", 3), "choose", {
    techId: "shared-supply-pod",
  });
  assert.equal(
    RESOURCES.reduce((n, r) => n + g.pending.pool[r], 0),
    4,
  );
  for (const id of ["P1", "P2", "P3"]) {
    assert.equal(g.pending.actor, id);
    g = act(g, "choose", {
      resource: RESOURCES.find((r) => g.pending.pool[r]),
    });
  }
  assert.equal(g.pending, null);
  assert.equal(g.events.filter((e) => e.type === "supply_discard").length, 1);
  g.players.forEach((p) =>
    assert.equal(
      RESOURCES.reduce((n, r) => n + p.resources[r], 0),
      13,
    ),
  );
});
test("mutual-aid protection lasts through the other player turn and expires only next round", () => {
  let g = act(tech("aid-beacon"), "choose", { techId: "aid-beacon" });
  g = act(g, "beacon", {
    targetId: "P2",
    give: { wood: 1 },
    receive: { metal: 1 },
  });
  g = act(g, "choose", { accept: true });
  for (let i = 0; i < 4; i++) g = act(g, "skip");
  assert.equal(g.turn, 1);
  assert.deepEqual(g.players[1].roundFlags.noConflictWith, ["P1"]);
  const check = structuredClone(g);
  check.phase = "choice";
  check.pending = {
    kind: "technology",
    actor: "P2",
    choices: ["recycling-claw"],
    resume: "cards",
  };
  assert.throws(
    () => act(check, "choose", { techId: "recycling-claw", targetId: "P1" }),
    /不能争夺/,
  );
  for (let i = 0; i < 4; i++) g = act(g, "skip");
  assert.equal(g.round, 2);
  assert.ok(
    g.players.every(
      (p) => !p.roundFlags.noConflictWith.length && !p.roundFlags.beacon,
    ),
  );
});
test("repeller offers discard or outward adjacent move; water-edge alarm loses hand if empty", () => {
  let g = tech("ecological-repeller");
  g.players[0].position = "5,0";
  g.players[1].position = "0,0";
  g = act(g, "choose", { techId: "ecological-repeller" });
  assert.equal(g.pending.remaining.length, 1);
  const target = Object.keys(viewGame(g).reachable).find(
    (id) => id !== g.players[0].position,
  );
  g = act(g, "choose", { tileId: target });
  assert.equal(g.players[0].position, target);
  g = tech("black-tide-alarm");
  g.players[0].position = TILES.find((t) => t.river).id;
  g.players[0].resources = bag();
  g.players[0].hand = [{ uid: "h", id: "invitation" }];
  g = act(g, "choose", { techId: "black-tide-alarm" });
  assert.equal(g.pending.kind, "tide");
  g = act(g, "choose", { cardUid: "h" });
  assert.equal(g.players[0].hand.length, 0);
});
test("prototype selects one action; blueprint recovers only action discard; claw steals real random resource", () => {
  let g = act(tech("rapid-prototyper"), "choose", {
    techId: "rapid-prototyper",
  });
  const uid = g.pending.choices[0].uid;
  g = act(g, "choose", { cardUid: uid });
  assert.ok(g.players[0].hand.some((c) => c.uid === uid));
  g = tech("ruins-blueprint");
  g.discard = [{ uid: "old", id: "invitation" }];
  g = act(g, "choose", { techId: "ruins-blueprint" });
  g = act(g, "choose", { cardUid: "old" });
  assert.equal(g.discard.length, 0);
  assert.ok(g.players[0].hand.some((c) => c.uid === "old"));
  g = act(tech("recycling-claw"), "choose", {
    techId: "recycling-claw",
    targetId: "P2",
  });
  assert.equal(
    RESOURCES.reduce((n, r) => n + g.players[0].resources[r], 0),
    13,
  );
  assert.equal(
    RESOURCES.reduce((n, r) => n + g.players[1].resources[r], 0),
    11,
  );
  assert.ok(g.events.some((e) => e.type === "steal"));
});
test("flood amounts, choices, discounts, no negative balances; named blade only if inundated", () => {
  let g = make();
  g.phase = "flood";
  g.floodLevel = 3;
  g.pending = { kind: "flood", actor: "P1", index: 0 };
  g.players[0].resources = { wood: 1, metal: 2, electricity: 1, seed: 1 };
  assert.deepEqual(floodCost(g, g.players[0]).mandatory, {
    wood: 0,
    metal: 0,
    electricity: 1,
    seed: 1,
  });
  g = act(g, "pay_flood", { resource: "metal" });
  assert.deepEqual(g.players[0].resources, {
    wood: 1,
    metal: 1,
    electricity: 0,
    seed: 0,
  });
  g.players[1].equipment = ["reserve-crate", "famed-blade"];
  g.players[1].resources = { wood: 1, metal: 1, electricity: 1, seed: 1 };
  g = act(g, "pay_flood");
  assert.equal(g.players[1].resources.wood, 1);
  assert.equal(g.pending.kind, "blade");
  g = act(g, "blade_move", { tileId: g.players[1].position });
  assert.ok(!g.players[1].equipment.includes("famed-blade"));
  g = make(1);
  g.round = 3;
  g.phase = "flood";
  g.floodLevel = 1;
  g.players[0].position = "0,0";
  g.players[0].equipment = ["famed-blade"];
  g.pending = { kind: "flood", actor: "P1", index: 0 };
  g = act(g, "pay_flood");
  assert.equal(g.round, 4);
  assert.ok(g.players[0].equipment.includes("famed-blade"));
});
test("technology can interrupt flood payment and restores pending payment afterwards", () => {
  let g = make(1);
  g.round = 3;
  g.phase = "flood";
  g.floodLevel = 1;
  g.pending = { kind: "flood", actor: "P1", index: 0 };
  g.players[0].hand = [{ uid: "tech", id: "technology" }];
  g = act(g, "play", { cardUid: "tech" });
  assert.equal(g.pending.resumePending.kind, "flood");
  g = act(g, "choose", { decline: true });
  assert.equal(g.phase, "flood");
  assert.equal(g.pending.kind, "flood");
});
test("reserve crate saves an actually held mandatory resource when optional inventory is empty", () => {
  let g = make(1);
  g.round = 5;
  g.phase = "flood";
  g.floodLevel = 2;
  g.pending = { kind: "flood", actor: "P1", index: 0 };
  g.players[0].resources.seed = 1;
  g.players[0].equipment = ["reserve-crate"];
  assert.equal(floodCost(g, g.players[0]).mandatory.seed, 0);
  g = act(g, "pay_flood");
  assert.equal(g.players[0].resources.seed, 1);
  assert.equal(g.round, 6);
});
test("multi-player technology interrupted during flood restores the exact settlement queue", () => {
  let g = make(3);
  g.round = 3;
  g.phase = "flood";
  g.floodLevel = 1;
  const flood = { kind: "flood", actor: "P1", index: 0 };
  g.pending = {
    kind: "technology",
    actor: "P1",
    choices: ["shared-supply-pod"],
    resume: "flood",
    resumePending: flood,
  };
  g = act(g, "choose", { techId: "shared-supply-pod" });
  for (let i = 0; i < 3; i++)
    g = act(g, "choose", {
      resource: RESOURCES.find((r) => g.pending.pool[r]),
    });
  assert.equal(g.phase, "flood");
  assert.deepEqual(g.pending, flood);
  const cost = floodCost(g, g.players[0]);
  g = act(g, "pay_flood", {
    resource: cost.choices.find((r) => g.players[0].resources[r] > 0),
  });
  assert.equal(g.pending.actor, "P2");
});
test("complete eight-round simulations cover all player counts, three exact floods, donation conservation and reproducibility", () => {
  for (let seed = 1; seed <= 12; seed++) {
    const { game: g } = simulate({ seed, players: (seed % 6) + 1 });
    assert.equal(g.status, "awaiting_judgment");
    assert.equal(g.round, 8);
    assert.deepEqual(
      g.events.filter((e) => e.type === "flood").map((e) => e.round),
      [3, 5, 7],
    );
    for (const e of g.events.filter((e) => e.type === "flood")) {
      assert.equal(
        e.resource,
        e.die <= 2 ? "wood" : e.die <= 4 ? "metal" : "electricity",
      );
      assert.ok(e.actual <= e.requested);
    }
    for (const r of RESOURCES) {
      assert.equal(
        g.ark[r],
        g.donations.reduce((n, d) => n + d.amounts[r], 0) -
          g.events
            .filter((e) => e.type === "flood" && e.resource === r)
            .reduce((n, e) => n + e.actual, 0),
      );
    }
    assert.equal(new Set(g.events.map((e) => e.seq)).size, g.events.length);
    assert.throws(() => act(g, "move", { tileId: "0,0" }), /结束/);
  }
  assert.deepEqual(
    simulate({ seed: 4, players: 2 }),
    simulate({ seed: 4, players: 2 }),
  );
});
test("draw schedule excludes round4 and draws after flood in round3; all stages remain auditable", () => {
  let g = make(1),
    guard = 0;
  while (g.status === "playing" && guard++ < 100) {
    g =
      g.phase === "evacuation"
        ? act(g, "evacuate", { tileId: g.players[0].position })
        : act(g, g.phase === "flood" ? "pay_flood" : "skip");
  }
  const draws = g.events.filter((e) =>
    ["draw", "draw_overflow"].includes(e.type),
  );
  assert.deepEqual(
    draws.map((e) => e.round),
    [1, 2, 3, 5, 6, 7, 8],
  );
  assert.ok(draws[2].seq > g.events.find((e) => e.type === "flood").seq);
  assert.equal(g.events.filter((e) => e.type === "action").length, 36);
});
