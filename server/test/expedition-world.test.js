import test from "node:test";
import assert from "node:assert/strict";
import { createGame, command, viewGame } from "../src/expedition/engine.js";
import { CHARACTERS, RESOURCES } from "../src/expedition/catalog.js";
import { TILES, tileById, distance } from "../src/expedition/map.js";
import {
  active,
  handLimit,
  isDisasterChoice,
} from "../src/expedition/world.js";
import { botAction, simulate } from "../src/expedition/simulation.js";
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
    type,
    actor: viewGame(g).activePlayerId,
    revision: g.revision,
    ...data,
  });
const set = (g, attributes) =>
  act(g, "set_world", {
    attributes: { ...g.world.base, ...attributes },
    reason: "规则回归测试",
  });
function drain(g, resource = "metal") {
  let guard = 0;
  while (isDisasterChoice(g)) {
    assert.ok(++guard < 40);
    const p = g.players.find((p) => p.id === g.pending.actor);
    g = act(g, "choose", {
      resource:
        g.pending.kind === "disaster_gain"
          ? resource
          : RESOURCES.find((r) => p.resources[r] > 0),
    });
  }
  return g;
}
function chooseTech(g, techId, input = {}) {
  g.pending = {
    kind: "technology",
    actor: g.players[g.turn].id,
    choices: [techId],
    resume: "cards",
  };
  g.phase = "choice";
  return act(g, "choose", { techId, ...input });
}
const entries = (g, id) =>
  g.events.filter((e) => e.type === "disaster_enter" && e.cardId === id).length;
const woodTile = TILES.find((t) => t.resource === "wood" && t.zone === 1).id;

test("one shared world: tech changes global scores, manual values survive other actions, failures are atomic", () => {
  let g = chooseTech(make(), "space-ring");
  assert.equal(g.attributes.economy, 12);
  assert.equal(g.players[0].attributes, undefined);
  assert.equal(g.players[0].worldImpact.economy, 2);
  assert.equal(g.players[1].worldImpact.economy, 0);
  g = set(g, { economy: 13, environment: 12, society: 11 });
  g = act(g, "skip");
  assert.deepEqual(g.attributes, { economy: 13, environment: 12, society: 11 });
  const before = structuredClone(g);
  for (const input of [
    { economy: 0, environment: 12, society: 11 },
    { economy: 20, environment: 12, society: 11 },
    { economy: 1.5, environment: 12, society: 11 },
    { economy: 10, environment: 10 },
  ])
    assert.throws(
      () => act(g, "set_world", { attributes: input, reason: "invalid" }),
      /1—19/,
    );
  assert.throws(
    () => act(g, "set_world", { attributes: g.attributes, reason: "" }),
    /原因/,
  );
  assert.deepEqual(g, before);
  assert.deepEqual(
    g.events.find((e) => e.type === "action" && e.command.type === "choose")
      .worldDelta,
    { economy: 2, environment: 0, society: 0 },
  );
});
test("upper thresholds stack; same-band and 18→17 preserve normal card without duplicate grants", () => {
  let g = make();
  g.players[0].resources.wood = 5;
  g = set(g, { economy: 18 });
  assert.deepEqual(
    g.activeDisasters.map((c) => c.id),
    ["develop-first", "wealth-gap"],
  );
  assert.equal(g.attributes.environment, 9);
  assert.equal(g.attributes.society, 9);
  g = drain(g);
  assert.equal(g.players[0].resources.metal, 2);
  assert.equal(g.players[1].resources.metal, 0);
  const grants = g.events.filter((e) => e.type === "disaster_resource").length;
  g = set(g, { economy: 19 });
  assert.equal(entries(g, "develop-first"), 1);
  assert.equal(entries(g, "wealth-gap"), 1);
  assert.equal(
    g.events.filter((e) => e.type === "disaster_resource").length,
    grants,
  );
  g = set(g, { economy: 17 });
  assert.equal(active(g, "wealth-gap"), false);
  assert.equal(active(g, "develop-first"), true);
  g = set(g, { economy: 18 });
  assert.equal(entries(g, "develop-first"), 1);
  assert.equal(entries(g, "wealth-gap"), 2);
  g = set(g, { economy: 13 });
  g = drain(set(g, { economy: 18 }));
  assert.equal(entries(g, "develop-first"), 2);
});
test("extreme low economy stacks recall and deflation; no refunds, no repeated confiscation", () => {
  let g = make();
  g.players[0].equipment = [
    "space-ring",
    "skateboard-shoes",
    "mining-drone",
    "reserve-crate",
    "aid-beacon",
    "famed-blade",
  ];
  g.players[0].hand = [
    { id: "technology", uid: "a" },
    { id: "technology", uid: "b" },
    { id: "invitation", uid: "c" },
  ];
  g = set(g, { economy: 2 });
  assert.deepEqual(
    g.activeDisasters.map((c) => c.id),
    ["depression", "deflation"],
  );
  assert.deepEqual(g.players[0].equipment, [
    "skateboard-shoes",
    "reserve-crate",
  ]);
  assert.deepEqual(
    g.players[0].hand.map((c) => c.uid),
    ["b", "c"],
  );
  assert.equal(handLimit(g, g.players[0]), 4);
  g = set(g, { economy: 1 });
  assert.equal(g.players[0].hand.length, 2);
  assert.equal(entries(g, "deflation"), 1);
  g = set(g, { economy: 3 });
  assert.equal(handLimit(g, g.players[0]), 5);
  assert.equal(entries(g, "depression"), 1);
  assert.ok(!g.players[0].equipment.includes("space-ring"));
});
test("ecological collapse uses shared historical harvests across players and clears restrictions on exit", () => {
  let g = make();
  g.phase = "gather";
  g.players[0].position = woodTile;
  g = act(g, "gather");
  assert.equal(g.world.harvested[woodTile], 1);
  g = set(g, { environment: 6 });
  g.turn = 1;
  g.phase = "gather";
  g.players[1].position = woodTile;
  assert.equal(viewGame(g).canGather, false);
  assert.throws(() => act(g, "gather"), /生态崩坏/);
  assert.equal(g.players[1].resources.wood, 0);
  g = set(g, { environment: 7 });
  g = act(g, "gather");
  assert.equal(g.players[1].resources.wood, 1);
  assert.equal(g.world.harvested[woodTile], 2);
});
test("extreme low society stacks restriction and 50% rich/poor harvest using current inventory", () => {
  let g = set(make(3), { society: 2 });
  assert.ok(active(g, "class-lock") && active(g, "social-disorder"));
  g.players[0].resources.metal = 10;
  g.players[2].donated.wood = 100;
  g.phase = "gather";
  g.players[0].position = woodTile;
  g.rng = 0;
  g = act(g, "gather");
  assert.equal(g.players[0].resources.wood, 2);
  g.turn = 1;
  g.phase = "gather";
  g.players[1].position = woodTile;
  g.rng = 0;
  g = act(g, "gather");
  assert.equal(g.players[1].resources.wood, 0);
  const event = g.events.filter((e) => e.type === "class_harvest").at(-1);
  assert.equal(event.rich, false);
  assert.equal(event.actual, 0);
  let single = set(make(1), { society: 1 });
  single.phase = "gather";
  single.players[0].position = woodTile;
  single.players[0].equipment = ["mining-drone"];
  single.rng = 0;
  single = act(single, "gather");
  assert.equal(single.players[0].resources.wood, 1);
});
test("steady imbalance asks resource type, then drifts immediately and once per later round", () => {
  let g = make();
  g.players.forEach((p) => (p.resources.wood = 2));
  g = set(g, { environment: 2 });
  assert.ok(active(g, "eco-collapse") && active(g, "steady-imbalance"));
  assert.equal(g.pending.kind, "disaster_loss");
  g = drain(g);
  assert.ok(g.players.every((p) => p.resources.wood === 1));
  assert.equal(g.events.filter((e) => e.type === "disaster_drift").length, 2);
  for (let i = 0; i < 8; i++) g = act(g, "skip");
  assert.equal(g.round, 2);
  assert.equal(g.events.filter((e) => e.type === "disaster_drift").length, 2);
  for (let i = 0; i < 8; i++) g = act(g, "skip");
  assert.equal(g.round, 3);
  assert.equal(g.events.filter((e) => e.type === "disaster_drift").length, 4);
  assert.ok(g.players.every((p) => tileById(p.position)?.terrain === "land"));
  g = set(g, { environment: 3 });
  assert.ok(!active(g, "steady-imbalance"));
  assert.ok(active(g, "eco-collapse"));
});
test("welfare grants once; mandatory mutual aid chooses resource at full round end before flood", () => {
  let g = make();
  g.players[0].resources.wood = 5;
  g = drain(set(g, { society: 18 }), "seed");
  assert.equal(g.attributes.economy, 9);
  assert.equal(g.attributes.environment, 9);
  assert.ok(g.players.every((p) => p.resources.seed === 1));
  g.round = 3;
  for (let i = 0; i < 8; i++) g = act(g, "skip");
  assert.equal(g.pending.kind, "disaster_aid");
  assert.equal(g.pending.actor, "P1");
  assert.equal(g.floodLevel, 0);
  g = act(g, "choose", { resource: "wood" });
  assert.equal(g.players[1].resources.wood, 1);
  assert.equal(g.pending.kind, "flood");
  assert.equal(g.floodLevel, 1);
  const count = g.events.filter(
    (e) => e.type === "disaster_resource" && e.mode === "disaster_aid",
  ).length;
  g = act(g, "pay_flood", { resource: "wood" });
  g = act(g, "pay_flood", { resource: "wood" });
  assert.equal(g.round, 4);
  assert.equal(
    g.events.filter(
      (e) => e.type === "disaster_resource" && e.mode === "disaster_aid",
    ).length,
    count,
  );
});
test("cascades snapshot all new cards before effects; normal then extreme, independent of input key order", () => {
  const a = drain(set(make(), { economy: 18, environment: 10, society: 18 }));
  const b = drain(
    act(make(), "set_world", {
      attributes: { society: 18, environment: 10, economy: 18 },
      reason: "规则回归测试",
    }),
  );
  assert.deepEqual(a.attributes, { economy: 17, environment: 8, society: 17 });
  assert.deepEqual(a.attributes, b.attributes);
  for (const id of [
    "develop-first",
    "wealth-gap",
    "welfare-pressure",
    "mutual-aid",
  ])
    assert.equal(entries(a, id), 1);
  for (const event of a.events.filter((e) => e.type === "disaster_enter"))
    assert.deepEqual(event.attributes, {
      economy: 18,
      environment: 10,
      society: 18,
    });
  assert.deepEqual(
    a.activeDisasters.map((c) => c.id),
    ["develop-first", "welfare-pressure"],
  );
  assert.equal(
    a.events.filter(
      (e) => e.type === "disaster_resource" && e.mode === "disaster_gain",
    ).length,
    4,
  );
});
test("eco conflict is a persistent modifier, not repeated damage, and coexists with resource protection", () => {
  let g = set(make(), { environment: 18 });
  assert.deepEqual(
    g.activeDisasters.map((c) => c.id),
    ["resource-protection", "eco-conflict"],
  );
  assert.equal(g.attributes.society, 9);
  assert.equal(g.world.base.society, 10);
  g = act(g, "skip");
  g = act(g, "skip");
  assert.equal(g.attributes.society, 9);
  g = set(g, { environment: 17 });
  assert.equal(g.attributes.society, 10);
  assert.ok(active(g, "resource-protection"));
});
test("adjacent player may spend to cancel negative environmental technology; pass executes it atomically", () => {
  let base = set(make(3), { environment: 18 });
  base.players.forEach((p, i) => {
    p.position = `${i},0`;
    p.resources.wood = 1;
  });
  const offered = chooseTech(structuredClone(base), "mining-drone");
  assert.equal(offered.pending.kind, "eco_block");
  assert.equal(offered.pending.actor, "P2");
  assert.equal(offered.attributes.economy, 10);
  const blocked = act(offered, "choose", { block: true, resource: "wood" });
  assert.equal(blocked.players[1].resources.wood, 0);
  assert.ok(!blocked.players[0].equipment.includes("mining-drone"));
  assert.equal(blocked.attributes.environment, 18);
  assert.equal(blocked.phase, "cards");
  assert.equal(blocked.pending, null);
  const allowed = act(offered, "choose", { block: false });
  assert.ok(allowed.players[0].equipment.includes("mining-drone"));
  assert.equal(allowed.attributes.environment, 16);
  assert.equal(allowed.attributes.economy, 12);
  assert.equal(allowed.attributes.society, 10);
  assert.ok(active(allowed, "resource-protection"));
  assert.ok(!active(allowed, "eco-conflict"));
  assert.throws(
    () => act(offered, "choose", { block: true, resource: "seed" }),
    /支付/,
  );
  assert.equal(offered.players[1].resources.wood, 1);
});
test("protection requires explicit reason and resource tile, adds only the chosen effect and triggers extreme stacking", () => {
  let g = set(make(), { environment: 17 });
  assert.throws(
    () =>
      act(g, "confirm_protection", {
        outcome: "protected",
        tileId: "0,0",
        reason: "保护",
      }),
    /资源格/,
  );
  g = act(g, "confirm_protection", {
    outcome: "protected",
    tileId: woodTile,
    reason: "确认保护该资源点",
  });
  assert.equal(g.attributes.environment, 18);
  assert.ok(active(g, "resource-protection") && active(g, "eco-conflict"));
  assert.equal(g.attributes.economy, 10);
  g = act(g, "confirm_protection", {
    outcome: "restricted",
    tileId: woodTile,
    reason: "确认该区域开发受限",
  });
  assert.equal(g.attributes.economy, 9);
  assert.equal(g.attributes.environment, 18);
  assert.equal(
    g.events.filter((e) => e.type === "protection_confirmation").length,
    2,
  );
});
test("social disorder rejects nonadjacent transactions, but never blocks ark donation or public supplies", () => {
  let g = set(make(), { society: 6 });
  g.players[0].resources.wood = 2;
  g.players[1].resources.metal = 2;
  g.players[0].hand = [{ id: "invitation", uid: "invite" }];
  assert.throws(
    () =>
      act(g, "play", {
        cardUid: "invite",
        targetId: "P2",
        give: { wood: 1 },
        receive: { metal: 1 },
      }),
    /社会失序/,
  );
  g.phase = "donate";
  g = act(g, "donate", { amounts: { wood: 1 } });
  assert.equal(g.ark.wood, 1);
  g = chooseTech(g, "shared-supply-pod");
  assert.equal(g.pending.kind, "supply");
  assert.equal(g.pending.remaining.length, 2);
});
test("disaster queue interrupts and restores the exact technology/flood continuation", () => {
  let g = set(make(), { economy: 12 });
  g.phase = "choice";
  const flood = { kind: "flood", actor: "P1", index: 0 };
  g.pending = {
    kind: "technology",
    actor: "P1",
    choices: ["mining-drone"],
    resume: "flood",
    resumePending: flood,
  };
  g.floodLevel = 1;
  g = act(g, "choose", { techId: "mining-drone" });
  assert.equal(g.pending.kind, "disaster_gain");
  g = drain(g);
  assert.equal(g.phase, "flood");
  assert.deepEqual(g.pending, flood);
});
test("legacy live migration preserves saved global values, derives harvest history, and all views are side-effect free", () => {
  const legacy = make();
  delete legacy.world;
  legacy.schemaVersion = 1;
  legacy.attributes = { economy: 12, environment: 10, society: 10 };
  legacy.players.forEach(
    (p) => (p.attributes = { economy: 1, environment: 19, society: 2 }),
  );
  const snapshot = structuredClone(legacy),
    v = viewGame(legacy);
  assert.equal(v.attributes.economy, 12);
  assert.equal(v.players[0].attributes, undefined);
  assert.deepEqual(legacy, snapshot);
  assert.deepEqual(viewGame(legacy), v);
  const next = act(legacy, "skip");
  assert.equal(next.attributes.economy, 12);
  assert.equal(next.schemaVersion, 2);
  assert.ok(next.events.some((e) => e.type === "world_migration"));
});
test("legacy first action respects stacked continuous effects without GET writes or failed-action side effects", () => {
  const legacy = make();
  delete legacy.world;
  legacy.schemaVersion = 1;
  legacy.attributes.environment = 2;
  legacy.activeDisasters = [
    { id: "steady-imbalance", dimension: "environment", band: "criticalLow" },
  ];
  legacy.players[0].position = woodTile;
  legacy.phase = "gather";
  legacy.events.push({
    type: "action",
    actor: "P1",
    command: { type: "gather" },
    effects: [{ playerId: "P1", from: woodTile }],
  });
  const snapshot = structuredClone(legacy);
  assert.equal(viewGame(legacy).canGather, false);
  assert.throws(() => act(legacy, "gather"), /已被采集/);
  assert.deepEqual(legacy, snapshot);
  const next = act(legacy, "skip");
  assert.equal(next.world.harvested[woodTile], 1);
  assert.equal(entries(next, "eco-collapse"), 1);
  assert.equal(entries(next, "steady-imbalance"), 1);
});
test("depression prunes confiscated blade escape queues and safely advances the flood", () => {
  let g = set(make(), { economy: 7 });
  g.round = 3;
  g.floodLevel = 1;
  g.players[0].equipment = ["famed-blade"];
  g.players[0].resources.wood = 2;
  g.phase = "choice";
  g.pending = {
    kind: "technology",
    actor: "P1",
    choices: ["alchemy-furnace"],
    resume: "flood",
    resumePending: { kind: "blade", actor: "P1", remaining: ["P1"] },
  };
  const position = g.players[0].position;
  g = act(g, "choose", {
    techId: "alchemy-furnace",
    spend: { wood: 2 },
    resource: "metal",
  });
  assert.equal(g.attributes.economy, 6);
  assert.equal(g.players[0].position, position);
  assert.deepEqual(g.players[0].equipment, []);
  assert.equal(g.round, 4);
  assert.equal(g.phase, "cards");
  assert.equal(g.pending, null);
  assert.ok(g.events.some((e) => e.type === "blade_queue_refresh"));
  assert.throws(() => act(g, "blade_move", { tileId: "0,0" }), /未知/);
});
test("drift during a pending trade revalidates adjacency at acceptance and still allows rejection", () => {
  let g = set(make(), { environment: 4, society: 6 });
  g.players.forEach((p) => {
    p.position = "0,0";
  });
  g.players[0].resources.wood = 3;
  g.players[1].resources.metal = 3;
  g.players[0].hand = [{ id: "invitation", uid: "invite" }];
  g = act(g, "play", {
    cardUid: "invite",
    targetId: "P2",
    give: { wood: 1 },
    receive: { metal: 1 },
  });
  const trade = g.pending;
  g.phase = "choice";
  g.pending = {
    kind: "technology",
    actor: "P2",
    choices: ["mining-drone"],
    resume: "choice",
    resumePending: trade,
  };
  g.rng = 3;
  g = drain(act(g, "choose", { techId: "mining-drone" }));
  assert.equal(g.pending.kind, "trade");
  assert.ok(distance(...g.players.map((p) => tileById(p.position))) > 1);
  const snapshot = structuredClone(g);
  assert.throws(() => act(g, "choose", { accept: true }), /位置已变化/);
  assert.deepEqual(g, snapshot);
  g = act(g, "choose", { accept: false });
  assert.equal(g.pending, null);
  assert.equal(g.phase, "cards");
  assert.equal(g.players[0].hand[0].uid, "invite");
});
test("a beacon confiscated during an exchange cannot grant an equipment-free trade", () => {
  let g = set(make(), { economy: 7 });
  g.players.forEach((p) => {
    p.position = "0,0";
    p.resources.wood = 4;
    p.resources.metal = 4;
  });
  g.players[0].equipment = ["aid-beacon"];
  g = act(g, "beacon", {
    targetId: "P2",
    give: { wood: 1 },
    receive: { metal: 1 },
  });
  const trade = g.pending;
  g.pending = {
    kind: "technology",
    actor: "P2",
    choices: ["alchemy-furnace"],
    resume: "choice",
    resumePending: trade,
  };
  g = act(g, "choose", {
    techId: "alchemy-furnace",
    spend: { wood: 2 },
    resource: "seed",
  });
  assert.equal(g.pending.kind, "trade");
  assert.deepEqual(g.players[0].equipment, []);
  assert.throws(() => act(g, "choose", { accept: true }), /已失效/);
  g = act(g, "choose", { accept: false });
  assert.equal(g.pending, null);
  assert.equal(g.players[0].roundFlags.beacon, false);
});
test("shared-world disaster simulations finish with nonnegative inventories and immutable final scores", () => {
  for (let seed = 1; seed <= 12; seed++) {
    let g = make((seed % 6) + 1);
    g.rng = seed;
    g = drain(
      set(
        g,
        seed % 2
          ? { economy: 2, environment: 2, society: 2 }
          : { economy: 18, environment: 18, society: 19 },
      ),
    );
    let guard = 0;
    while (g.status === "playing") {
      assert.ok(++guard < 2500);
      g = command(g, botAction(g));
      for (const p of g.players)
        for (const r of RESOURCES) assert.ok(p.resources[r] >= 0);
    }
    assert.equal(g.round, 8);
    assert.equal(g.events.filter((e) => e.type === "flood").length, 3);
    assert.throws(
      () =>
        act(g, "set_world", {
          attributes: { economy: 10, environment: 10, society: 10 },
          reason: "结束",
        }),
      /结束/,
    );
  }
  assert.deepEqual(
    simulate({ seed: 21, players: 4 }),
    simulate({ seed: 21, players: 4 }),
  );
});
