import { readFileSync } from "node:fs";
import { resolveDisasters } from "../catalog.js";
import { RESOURCES, LABELS, getTech } from "./catalog.js";
import { tileById, reachable, flooded } from "./map.js";
import { bag, sum, clamp, log, random, requireRule } from "./runtime.js";

export const DIMENSIONS = ["economy", "environment", "society"];
export const DISASTER_RULES = JSON.parse(
  readFileSync(
    new URL("../../data/expedition/disaster-rules.json", import.meta.url),
    "utf8",
  ),
);
export const active = (g, id) => g.activeDisasters.some((c) => c.id === id);
export const handLimit = (g, p) =>
  (p.equipment.includes("space-ring") ? 8 : 5) -
  (active(g, "deflation") ? 1 : 0);
const player = (g, id) => g.players.find((p) => p.id === id);
const ranked = (g) =>
  [...g.players].sort(
    (a, b) =>
      sum(b.resources) - sum(a.resources) ||
      g.players.indexOf(a) - g.players.indexOf(b),
  );

// Migrate only a working copy. GET never awards resources or rewrites a save.
export function ensureWorld(g, notify = false) {
  if (g.world) return;
  const harvested = {};
  for (const e of g.events)
    if (e.type === "action" && e.command?.type === "gather") {
      const tile = e.effects?.find((p) => p.playerId === e.actor)?.from;
      if (tile) harvested[tile] = (harvested[tile] || 0) + 1;
    }
  g.world = {
    base: { ...g.attributes },
    modifiers: { economy: 0, environment: 0, society: 0 },
    activeIds: [],
    activationCounter: 0,
    queue: [],
    suspended: null,
    harvested,
    lastDriftRound: null,
    lastAidRound: null,
    policyVersion: DISASTER_RULES.version,
  };
  for (const p of g.players) {
    delete p.attributes;
    p.worldImpact ||= { economy: 0, environment: 0, society: 0 };
  }
  if (notify)
    log(
      g,
      "system",
      "world_migration",
      "旧局迁移为共享世界分数；保留最近世界值，不重算个人均分；历史审判不改写",
    );
  g.schemaVersion = 2;
}

export function refreshAttributes(g) {
  const baseCards = resolveDisasters(g.world.base, g.activeDisasters, () => 0);
  g.world.modifiers = {
    economy: 0,
    environment: 0,
    society: baseCards.some((c) => c.id === "eco-conflict") ? -1 : 0,
  };
  g.attributes = Object.fromEntries(
    DIMENSIONS.map((k) => [k, clamp(g.world.base[k] + g.world.modifiers[k])]),
  );
}

export function changeWorld(g, delta, { actor = "system", source } = {}) {
  const before = { ...g.attributes },
    baseBefore = { ...g.world.base };
  for (const k of DIMENSIONS)
    g.world.base[k] = clamp(g.world.base[k] + (delta[k] || 0));
  refreshAttributes(g);
  const applied = Object.fromEntries(
    DIMENSIONS.map((k) => [k, g.attributes[k] - before[k]]),
  );
  const p = player(g, actor);
  if (p) for (const k of DIMENSIONS) p.worldImpact[k] += applied[k];
  log(g, actor, "world_change", `全局世界变化：${source}`, {
    source,
    requested: delta,
    before,
    after: { ...g.attributes },
    baseBefore,
    baseAfter: { ...g.world.base },
    applied,
  });
}

export function setWorld(g, attributes, actor, reason) {
  requireRule(
    attributes &&
      Object.keys(attributes).length === 3 &&
      DIMENSIONS.every(
        (k) =>
          Number.isInteger(attributes[k]) &&
          attributes[k] >= 1 &&
          attributes[k] <= 19,
      ),
    "世界三属性必须为 1—19 的整数",
  );
  requireRule(
    typeof reason === "string" &&
      reason.trim().length > 0 &&
      reason.length <= 500,
    "请填写不超过 500 字的调节原因",
  );
  // A facilitator's manual edit is audited, not credited to the current player.
  changeWorld(
    g,
    Object.fromEntries(
      DIMENSIONS.map((k) => [k, attributes[k] - g.world.base[k]]),
    ),
    { source: "手动调节" },
  );
  log(g, actor, "world_manual", "手动调节共享世界状态", {
    reason: reason.trim(),
    requested: { ...attributes },
  });
}

function enqueue(g, card, kind, actor, extra = {}) {
  g.world.queue.push({
    kind: `disaster_${kind}`,
    cardId: card.id,
    cardName: card.name,
    actor,
    ...extra,
  });
}
function drift(g, source) {
  const directions = [
    [1, 0],
    [1, -1],
    [0, -1],
    [-1, 0],
    [-1, 1],
    [0, 1],
  ];
  for (const p of g.players) {
    const die = 1 + Math.floor(random(g) * 6),
      [dq, dr] = directions[die - 1],
      from = p.position,
      tile = tileById(from),
      target = `${tile.q + dq},${tile.r + dr}`;
    const allowed = reachable(from, 1, g.floodLevel, { escape: true });
    if (allowed[target]) p.position = target;
    log(g, p.id, "disaster_drift", "稳态失衡：随机方向强制移动一步", {
      cardId: "steady-imbalance",
      source,
      die,
      target,
      from,
      to: p.position,
      blocked: from === p.position,
    });
  }
  g.world.lastDriftRound = g.round;
}
function enter(g, card) {
  const id = card.id;
  if (id === "deflation") {
    for (const p of g.players) {
      const index = p.hand.findIndex((c) => c.id === "technology");
      const removed = index < 0 ? [] : p.hand.splice(index, 1);
      g.discard.push(...removed);
      log(
        g,
        p.id,
        "disaster_hand_loss",
        "通货紧缩：失去一张科技手牌；在场期间手牌上限减一",
        { cardId: id, removed, actual: removed.length },
      );
    }
  } else if (id === "depression") {
    for (const p of g.players) {
      const removed = p.equipment.filter(
        (id) => getTech(id)?.status.economy > 0,
      );
      p.equipment = p.equipment.filter((id) => !removed.includes(id));
      log(g, p.id, "disaster_recall", "经济萧条：收回已装备的经济增益科技", {
        cardId: id,
        removed,
      });
    }
  } else if (id === "develop-first" || id === "welfare-pressure") {
    changeWorld(g, { environment: -1 }, { source: card.name });
    for (const p of g.players) enqueue(g, card, "gain", p.id);
  } else if (id === "wealth-gap") {
    changeWorld(g, { society: -1 }, { source: card.name });
    enqueue(g, card, "tribute", "system");
  } else if (id === "mutual-aid") {
    changeWorld(g, { economy: -1 }, { source: card.name });
  } else if (id === "steady-imbalance") {
    for (const p of g.players) enqueue(g, card, "loss", p.id);
    enqueue(g, card, "drift", "system", { source: "enter" });
  }
}

// Fixed-point resolution: enter/exit is keyed by card identity, not dimension.
// Only entry handlers run; continuous effects are predicates in action rules.
export function syncDisasters(g) {
  ensureWorld(g);
  for (let guard = 0; guard < 80; guard++) {
    refreshAttributes(g);
    const cards = resolveDisasters(g.attributes, g.activeDisasters, () =>
      random(g),
    );
    const ids = cards.map((c) => c.id),
      previous = g.world.activeIds;
    const entering = cards
      .filter((c) => !previous.includes(c.id))
      .sort(
        (a, b) =>
          Number(a.band.startsWith("critical")) -
            Number(b.band.startsWith("critical")) ||
          DIMENSIONS.indexOf(a.dimension) - DIMENSIONS.indexOf(b.dimension),
      );
    for (const id of previous.filter((id) => !ids.includes(id)))
      log(
        g,
        "system",
        "disaster_exit",
        `灾难解除：${g.activeDisasters.find((c) => c.id === id)?.name || id}`,
        { cardId: id },
      );
    g.activeDisasters = cards;
    g.world.activeIds = ids;
    if (!entering.length) return;
    const triggerAttributes = { ...g.attributes };
    for (const card of entering) {
      const activation = ++g.world.activationCounter;
      log(g, "system", "disaster_enter", `灾难触发：${card.name}`, {
        cardId: card.id,
        activation,
        attributes: triggerAttributes,
        effect: card.effect,
      });
      enter(g, card);
    }
  }
  throw new Error("灾难连锁未收敛，未保存本次操作");
}

export function queueRoundDisasters(g) {
  if (active(g, "mutual-aid") && g.world.lastAidRound !== g.round) {
    g.world.lastAidRound = g.round;
    const order = ranked(g),
      rich = order[0],
      poor = order.at(-1);
    if (rich.id !== poor.id && sum(rich.resources) > 0)
      enqueue(
        g,
        g.activeDisasters.find((c) => c.id === "mutual-aid"),
        "aid",
        rich.id,
        { targetId: poor.id },
      );
    else
      log(
        g,
        "system",
        "disaster_aid_skip",
        "强制互助：单人或全员无资源，本轮无可转移物资",
      );
  }
  if (active(g, "steady-imbalance") && g.world.lastDriftRound !== g.round) {
    enqueue(
      g,
      g.activeDisasters.find((c) => c.id === "steady-imbalance"),
      "drift",
      "system",
      { source: "round_end" },
    );
  }
}
export const isDisasterChoice = (g) => g.pending?.kind.startsWith("disaster_");

export function pumpDisasters(g) {
  if (isDisasterChoice(g)) return;
  if (g.world.queue.length && !g.world.suspended)
    g.world.suspended = { phase: g.phase, pending: g.pending };
  while (g.world.queue.length) {
    const task = g.world.queue[0];
    if (task.kind === "disaster_drift") {
      drift(g, task.source);
      g.world.queue.shift();
      continue;
    }
    if (task.kind === "disaster_tribute") {
      const order = ranked(g),
        rich = order[0],
        poor = order.at(-1),
        resource = DISASTER_RULES.crystalResource;
      const actual =
        rich.id !== poor.id && poor.resources[resource] > 0 ? 1 : 0;
      poor.resources[resource] -= actual;
      rich.resources[resource] += actual;
      log(
        g,
        poor.id,
        "disaster_tribute",
        "财富悬殊：最穷者向最富者缴纳晶矿（金属）",
        { cardId: task.cardId, targetId: rich.id, resource, actual },
      );
      g.world.queue.shift();
      continue;
    }
    if (
      task.kind === "disaster_loss" &&
      sum(player(g, task.actor).resources) === 0
    ) {
      log(g, task.actor, "disaster_resource", `${task.cardName}：无资源可扣`, {
        cardId: task.cardId,
        actual: 0,
      });
      g.world.queue.shift();
      continue;
    }
    g.phase = "disaster";
    g.pending = { ...task };
    return;
  }
  if (g.world.suspended) {
    g.phase = g.world.suspended.phase;
    g.pending = g.world.suspended.pending;
    g.world.suspended = null;
  }
}
export function resolveDisasterChoice(g, input) {
  const task = g.pending,
    p = player(g, task.actor),
    resource = input.resource;
  requireRule(input.type === "choose", "请先完成灾难结算");
  requireRule(
    DISASTER_RULES.grantResources.includes(resource),
    "请选择有效资源",
  );
  if (task.kind === "disaster_gain") p.resources[resource]++;
  else {
    requireRule(p.resources[resource] > 0, "所选资源不足");
    p.resources[resource]--;
    if (task.kind === "disaster_aid")
      player(g, task.targetId).resources[resource]++;
  }
  log(
    g,
    p.id,
    "disaster_resource",
    `${task.cardName}：${task.kind === "disaster_gain" ? "领取" : task.kind === "disaster_aid" ? "转移" : "失去"}${LABELS[resource]} 1`,
    {
      cardId: task.cardId,
      resource,
      amount: 1,
      mode: task.kind,
      targetId: task.targetId || null,
    },
  );
  g.world.queue.shift();
  g.pending = null;
}

export function canGather(g, p) {
  const tile = tileById(p.position);
  if (!tile?.resource || flooded(tile, g.floodLevel)) return false;
  return !(
    active(g, "eco-collapse") &&
    DISASTER_RULES.naturalResources.includes(tile.resource) &&
    g.world.harvested[tile.id]
  );
}
export function gatherYield(g, p, base) {
  requireRule(canGather(g, p), "生态崩坏：该自然地块已被采集，不能再次产出");
  let amount = base;
  if (active(g, "class-lock")) {
    const order = ranked(g),
      rich = order
        .slice(0, Math.floor(order.length / 2))
        .some((t) => t.id === p.id),
      roll = random(g),
      delta = roll < 0.5 ? (rich ? 1 : -1) : 0;
    amount = Math.max(0, base + delta);
    log(g, p.id, "class_harvest", "阶层固化：按采集前库存排名进行 50% 判定", {
      rich,
      ranking: order.map((p) => ({ id: p.id, total: sum(p.resources) })),
      roll,
      base,
      delta,
      actual: amount,
    });
  }
  g.world.harvested[p.position] = (g.world.harvested[p.position] || 0) + 1;
  return amount;
}
export function confirmProtection(g, p, input) {
  requireRule(active(g, "resource-protection"), "资源保护灾难当前未触发");
  requireRule(
    ["protected", "restricted"].includes(input.outcome),
    "请选择保护成功或开发受限",
  );
  requireRule(tileById(input.tileId)?.resource, "请在地图选择一个资源格");
  requireRule(
    typeof input.reason === "string" &&
      input.reason.trim() &&
      input.reason.length <= 500,
    "请填写条件发生的原因（不超过500字）",
  );
  changeWorld(
    g,
    input.outcome === "protected" ? { environment: 1 } : { economy: -1 },
    { actor: p.id, source: "资源保护条件确认" },
  );
  log(g, p.id, "protection_confirmation", "人工确认资源保护条件", {
    outcome: input.outcome,
    tileId: input.tileId,
    reason: input.reason.trim(),
  });
}
