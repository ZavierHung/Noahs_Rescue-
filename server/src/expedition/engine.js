import { CARDS, CHARACTERS, RESOURCES, LABELS, getTech } from "./catalog.js";
import {
  FLAGS,
  TILES,
  tileById,
  neighbors,
  reachable,
  flooded,
  distance,
} from "./map.js";
import { resolveDisasters } from "../catalog.js";

export const bag = () => Object.fromEntries(RESOURCES.map((r) => [r, 0]));
const sum = (b) => RESOURCES.reduce((n, r) => n + (b[r] || 0), 0);
const clamp = (n) => Math.max(1, Math.min(19, n));
const fail = (message) => {
  throw Object.assign(new Error(message), { status: 400 });
};
const requireRule = (condition, message) => {
  if (!condition) fail(message);
};
export const playerAt = (g, id) => g.players.find((p) => p.id === id);
export const activePlayer = (g) =>
  playerAt(g, g.pending?.actor || g.players[g.turn]?.id);
const has = (p, id) => p.equipment.includes(id);
const handLimit = (p) => (has(p, "space-ring") ? 8 : 5);
const ACTION_NAMES = {
  skip: "跳过",
  play: "使用手牌",
  choose: "确认选择",
  discard: "弃牌",
  beacon: "互助交换",
  move: "移动",
  gather: "采集",
  donate: "上交物资",
  pay_flood: "结算洪水损失",
  blade_move: "名刀逃生",
};
const PHASE_NAMES = {
  cards: "出牌",
  move: "移动",
  gather: "采集",
  donate: "捐赠",
  choice: "卡牌选择",
  flood: "洪水",
  judgment: "审判",
};
export const random = (g) => {
  g.rng = (Math.imul(g.rng, 1664525) + 1013904223) >>> 0;
  return g.rng / 4294967296;
};
const pick = (g, rows) => rows[Math.floor(random(g) * rows.length)];
const log = (g, actor, type, detail, data = {}) =>
  g.events.push({
    seq: g.events.length + 1,
    round: g.round,
    turn: g.turn,
    actor,
    type,
    detail,
    ...data,
  });
function add(p, resource, amount) {
  requireRule(RESOURCES.includes(resource), "无效资源");
  p.resources[resource] += amount;
}
function take(p, r, n = 1) {
  const actual = Math.min(p.resources[r], n);
  p.resources[r] -= actual;
  return actual;
}
function validateBag(value, { empty = false } = {}) {
  requireRule(
    value && typeof value === "object" && !Array.isArray(value),
    "资源数量格式不正确",
  );
  requireRule(
    Object.keys(value).every((r) => RESOURCES.includes(r)),
    "包含未知资源",
  );
  const result = bag();
  for (const r of RESOURCES) {
    const n = value[r] ?? 0;
    requireRule(
      Number.isInteger(n) && n >= 0 && n <= 999,
      "资源数量必须是非负整数",
    );
    result[r] = n;
  }
  requireRule(empty || sum(result) > 0, "请选择资源");
  return result;
}
function canPay(p, cost) {
  return RESOURCES.every((r) => p.resources[r] >= cost[r]);
}
function pay(p, cost) {
  requireRule(canPay(p, cost), "物资不足");
  for (const r of RESOURCES) p.resources[r] -= cost[r];
}
function draw(g, p, count = 1) {
  for (let i = 0; i < count; i++) {
    const action = pick(g, CARDS.actions),
      instance = { uid: `C${++g.cardCounter}`, id: action.id };
    if (p.hand.length >= handLimit(p)) {
      g.discard.push(instance);
      log(g, p.id, "draw_overflow", `手牌已达上限，${action.name}进入弃牌堆`, {
        card: instance,
      });
    } else {
      p.hand.push(instance);
      log(g, p.id, "draw", `抽取${action.name}`, { card: instance });
    }
  }
}
function turnStart(g) {
  g.phase = "cards";
  g.pending = null;
}
function nextRound(g) {
  if (g.round === 8) {
    g.status = "awaiting_judgment";
    g.phase = "judgment";
    log(g, "system", "game_end", "八回合结束，封存全局日志，等待上帝审判");
    return;
  }
  g.round++;
  g.turn = 0;
  for (const p of g.players)
    p.roundFlags = { beacon: false, noInvite: false, noConflictWith: [] };
  if ([2, 5, 6, 7, 8].includes(g.round)) for (const p of g.players) draw(g, p);
  turnStart(g);
}
function finishFlood(g) {
  const blades = g.players.filter(
    (p) => has(p, "famed-blade") && flooded(tileById(p.position), g.floodLevel),
  );
  if (blades.length) {
    g.pending = {
      kind: "blade",
      actor: blades[0].id,
      remaining: blades.map((p) => p.id),
    };
    g.phase = "flood";
    return;
  }
  if (g.round === 3) for (const p of g.players) draw(g, p);
  nextRound(g);
}
function floodStart(g) {
  g.floodLevel++;
  const die = 1 + Math.floor(random(g) * 6),
    resource = die <= 2 ? "wood" : die <= 4 ? "metal" : "electricity";
  const loss = Math.min(g.ark[resource], g.floodLevel);
  g.ark[resource] -= loss;
  log(
    g,
    "system",
    "flood",
    `第 ${g.floodLevel} 次洪水：淹没 ${4 - g.floodLevel} 区；骰子 ${die}，方舟扣除${LABELS[resource]} ${loss}`,
    {
      die,
      resource,
      requested: g.floodLevel,
      actual: loss,
      zone: 4 - g.floodLevel,
    },
  );
  g.phase = "flood";
  g.pending = { kind: "flood", actor: g.players[0].id, index: 0 };
}
function finishTurn(g) {
  if (g.turn < g.players.length - 1) {
    g.turn++;
    turnStart(g);
    return;
  }
  if ([3, 5, 7].includes(g.round)) floodStart(g);
  else nextRound(g);
}
function updateWorld(g) {
  g.attributes = Object.fromEntries(
    ["economy", "environment", "society"].map((k) => [
      k,
      Math.round(
        g.players.reduce((n, p) => n + p.attributes[k], 0) / g.players.length,
      ),
    ]),
  );
  g.activeDisasters = resolveDisasters(g.attributes, g.activeDisasters);
}
export function createGame(
  input,
  { id = "EXP-local", seed = Date.now() >>> 0 } = {},
) {
  requireRule(
    Array.isArray(input.players) &&
      input.players.length >= 1 &&
      input.players.length <= 6,
    "请选择 1—6 名玩家",
  );
  const characters = new Set(),
    spawns = new Set();
  const players = input.players.map((row, i) => {
    const character = CHARACTERS.find((c) => c.id === row.characterId),
      flag = FLAGS.find((f) => f.id === row.flagId);
    requireRule(character && flag, "角色或出生旗子无效");
    requireRule(
      !characters.has(character.id) && !spawns.has(flag.id),
      "角色和出生旗子不能重复",
    );
    characters.add(character.id);
    spawns.add(flag.id);
    return {
      id: `P${i + 1}`,
      name:
        typeof row.name === "string" && row.name.trim()
          ? row.name.trim().slice(0, 24)
          : character.name,
      characterId: character.id,
      position: flag.tileId,
      spawn: flag.id,
      resources: bag(),
      attributes: { economy: 10, environment: 10, society: 10 },
      hand: [],
      equipment: [],
      donated: bag(),
      roundFlags: { beacon: false, noInvite: false, noConflictWith: [] },
    };
  });
  const seats = input.seats ?? Math.min(3, players.length);
  requireRule(
    Number.isInteger(seats) && seats >= 1 && seats <= players.length,
    "方舟席位必须在 1 与玩家人数之间",
  );
  const g = {
    schemaVersion: 1,
    id,
    revision: 1,
    status: "playing",
    round: 1,
    turn: 0,
    phase: "cards",
    rng: seed >>> 0,
    cardCounter: 0,
    players,
    ark: bag(),
    seats,
    floodLevel: 0,
    discard: [],
    pending: null,
    events: [],
    donations: [],
    attributes: { economy: 10, environment: 10, society: 10 },
    activeDisasters: [],
    judgment: null,
  };
  log(g, "system", "create", "角色与旗子确认，游戏开始", {
    players: players.map((p) => ({
      id: p.id,
      characterId: p.characterId,
      spawn: p.spawn,
      position: p.position,
    })),
    seats,
  });
  for (const p of players) draw(g, p);
  return g;
}
function nearby(a, b) {
  return (
    a.id !== b.id && distance(tileById(a.position), tileById(b.position)) <= 1
  );
}
function technology(g, p, id, input) {
  const card = getTech(id);
  requireRule(card, "未知科技");
  const passive = [
    "space-ring",
    "skateboard-shoes",
    "mining-drone",
    "reserve-crate",
    "aid-beacon",
    "famed-blade",
  ].includes(id);
  if (passive && has(p, id)) {
    log(g, p.id, "duplicate_technology", `${card.name}已生效，同类不叠加`);
    g.phase = g.pending.resume;
    g.pending = null;
    return;
  }
  const resume = g.pending.resume;
  g.pending = null;
  g.phase = resume;
  // All input-dependent effects are validated before applying; command() clones
  // state, so any later validation error rolls the entire transaction back.
  if (passive) p.equipment.push(id);
  if (id === "alchemy-furnace") {
    const cost = validateBag(input.spend);
    requireRule(sum(cost) === 2, "炼金炉需要两份资源");
    pay(p, cost);
    add(p, input.resource, 3);
    p.roundFlags.noInvite = true;
  } else if (id === "shared-supply-pod") {
    const pool = bag();
    for (let i = 0; i < g.players.length + 1; i++) pool[pick(g, RESOURCES)]++;
    const start = g.players.indexOf(p),
      order = Array.from(
        { length: g.players.length },
        (_, i) => g.players[(start + i) % g.players.length].id,
      );
    g.pending = {
      kind: "supply",
      actor: order[0],
      remaining: order,
      pool,
      resume,
      owner: p.id,
    };
    g.phase = "choice";
    log(g, p.id, "supply_pool", "公开补给池，按顺序各选择一份", {
      pool: structuredClone(pool),
    });
  } else if (id === "ecological-repeller" || id === "black-tide-alarm") {
    const targets = g.players.filter((t) =>
      id === "ecological-repeller"
        ? tileById(t.position).zone !== 0
        : tileById(t.position).river ||
          tileById(t.position).terrain === "water" ||
          neighbors(tileById(t.position)).some(
            (n) =>
              n.terrain === "water" ||
              n.river ||
              flooded(n, g.floodLevel) ||
              neighbors(n).length < 6,
          ),
    );
    if (targets.length) {
      g.pending = {
        kind: id === "ecological-repeller" ? "repeller" : "tide",
        actor: targets[0].id,
        remaining: targets.map((t) => t.id),
        resume,
        owner: p.id,
      };
      g.phase = "choice";
    }
  } else if (id === "rapid-prototyper") {
    const choices = Array.from({ length: 2 }, () => ({
      uid: `C${++g.cardCounter}`,
      id: pick(g, CARDS.actions).id,
    }));
    g.pending = { kind: "prototype", actor: p.id, choices, resume };
    g.phase = "choice";
  } else if (id === "ruins-blueprint") {
    if (g.discard.length) {
      g.pending = {
        kind: "recover",
        actor: p.id,
        choices: structuredClone(g.discard),
        resume,
      };
      g.phase = "choice";
    } else log(g, p.id, "empty_discard", "弃牌堆为空，废墟蓝图无可回收牌");
  } else if (id === "recycling-claw") {
    const target = playerAt(g, input.targetId);
    requireRule(target && nearby(p, target), "机械爪需要相邻玩家");
    requireRule(
      !p.roundFlags.noConflictWith.includes(target.id),
      "本回合已与此玩家互助，不能争夺",
    );
    const available = RESOURCES.flatMap((r) =>
      Array(target.resources[r]).fill(r),
    );
    if (available.length) {
      const resource = pick(g, available);
      take(target, resource);
      add(p, resource, 1);
      log(g, p.id, "steal", `从 ${target.name} 随机取走${LABELS[resource]}`, {
        targetId: target.id,
        resource,
      });
    } else draw(g, p);
  }
  for (const [dimension, delta] of Object.entries(card.status || {}))
    p.attributes[dimension] = clamp(p.attributes[dimension] + delta);
  log(g, p.id, "technology", `使用科技：${card.name}`, {
    cardId: id,
    status: card.status,
  });
}
function restore(g, pending) {
  g.phase = pending.resume;
  g.pending = pending.resumePending || null;
}
function nextChoice(g) {
  const pending = g.pending;
  pending.remaining.shift();
  if (pending.remaining.length) pending.actor = pending.remaining[0];
  else {
    if (pending.kind === "supply")
      log(g, "system", "supply_discard", "未领取的补给退回资源池", {
        pool: pending.pool,
      });
    restore(g, pending);
  }
}
function resolveChoice(g, p, input) {
  const pending = g.pending;
  if (pending.kind === "technology") {
    if (input.decline === true) {
      restore(g, pending);
      log(g, p.id, "technology_decline", "放弃本次科技收益");
      return;
    }
    requireRule(
      pending.choices.includes(input.techId),
      "请从本次抽到的两张科技中选择",
    );
    technology(g, p, input.techId, input);
    if (g.pending) g.pending.resumePending = pending.resumePending || null;
    else if (pending.resumePending) g.pending = pending.resumePending;
  } else if (pending.kind === "trade") {
    const owner = playerAt(g, pending.owner);
    if (input.accept === true) {
      const give = validateBag(pending.give),
        receive = validateBag(pending.receive);
      requireRule(
        canPay(owner, give) && canPay(p, receive),
        "交易双方资源不足",
      );
      pay(owner, give);
      pay(p, receive);
      for (const r of RESOURCES) {
        owner.resources[r] += receive[r];
        p.resources[r] += give[r];
      }
      if (pending.beacon) {
        owner.roundFlags.beacon = true;
        owner.roundFlags.noConflictWith.push(p.id);
        p.roundFlags.noConflictWith.push(owner.id);
      } else {
        owner.hand.splice(
          owner.hand.findIndex((c) => c.uid === pending.cardUid),
          1,
        );
        g.discard.push({ uid: pending.cardUid, id: "invitation" });
      }
      log(g, owner.id, "trade_accept", `${p.name}接受资源交换`, {
        targetId: p.id,
        give,
        receive,
      });
    } else {
      requireRule(input.accept === false, "请选择接受或拒绝");
      log(g, p.id, "trade_reject", "拒绝邀约，对方可换目标重试", {
        owner: owner.id,
      });
    }
    restore(g, pending);
  } else if (pending.kind === "supply") {
    requireRule(pending.pool[input.resource] > 0, "该资源已被领完");
    pending.pool[input.resource]--;
    add(p, input.resource, 1);
    nextChoice(g);
  } else if (pending.kind === "prototype" || pending.kind === "recover") {
    const chosen = pending.choices.find((c) => c.uid === input.cardUid);
    requireRule(chosen, "请选择有效的行动牌");
    requireRule(p.hand.length < handLimit(p), "手牌已满，请先弃一张");
    p.hand.push(chosen);
    if (pending.kind === "recover")
      g.discard.splice(
        g.discard.findIndex((c) => c.uid === chosen.uid),
        1,
      );
    else
      log(
        g,
        p.id,
        "deck_return",
        "未选择的行动卡放回牌池（等概率有放回规则）",
        { cards: pending.choices.filter((c) => c.uid !== chosen.uid) },
      );
    restore(g, pending);
  } else if (pending.kind === "repeller" || pending.kind === "tide") {
    if (input.tileId && pending.kind === "repeller") {
      const choices = reachable(p.position, 1, g.floodLevel, { away: true });
      requireRule(
        input.tileId !== p.position && choices[input.tileId],
        "须远离方舟移动一格",
      );
      p.position = input.tileId;
    } else if (sum(p.resources) > 0) {
      requireRule(p.resources[input.resource] > 0, "请选择一份持有资源");
      take(p, input.resource);
    } else if (pending.kind === "tide" && p.hand.length) {
      const i = p.hand.findIndex((c) => c.uid === input.cardUid);
      requireRule(i >= 0, "无资源时需弃一张手牌");
      g.discard.push(...p.hand.splice(i, 1));
    } else if (pending.kind === "repeller") {
      requireRule(
        Object.keys(reachable(p.position, 1, g.floodLevel, { away: true }))
          .length <= 1,
        "无资源时请选择远离方舟移动一格",
      );
      log(g, p.id, "unpayable", "无资源且无可用远离路径，记录无法执行");
    }
    nextChoice(g);
  }
}
export function floodCost(g, p) {
  const cost = bag();
  if (g.floodLevel >= 2) cost.seed++;
  if (g.floodLevel >= 3) cost.electricity++;
  let choices =
    g.floodLevel === 1
      ? ["wood", "metal"]
      : g.floodLevel === 2
        ? ["wood", "metal", "electricity"]
        : RESOURCES;
  // Discount an actually payable unit: the optional unit first, otherwise one
  // held mandatory resource. Missing resources must not consume the discount.
  let optional = 1;
  if (has(p, "reserve-crate")) {
    if (choices.some((r) => p.resources[r] > cost[r])) optional = 0;
    else {
      const protectedResource = RESOURCES.find(
        (r) => cost[r] > 0 && p.resources[r] > 0,
      );
      if (protectedResource) cost[protectedResource]--;
      optional = 0;
    }
  }
  return { mandatory: cost, choices, optional };
}
export function command(original, input) {
  const g = structuredClone(original);
  requireRule(g.status === "playing", "本局已结束，不能再进行回合操作");
  requireRule(
    Number.isInteger(input.revision) && input.revision === g.revision,
    "状态已更新，请刷新后重试",
  );
  const p = activePlayer(g);
  requireRule(input.actor === p.id, "请由当前行动玩家操作");
  const before = structuredClone(g.players),
    arkBefore = { ...g.ark };
  if (
    input.type === "play" &&
    p.hand.some((c) => c.uid === input.cardUid && c.id === "technology")
  ) {
    const index = p.hand.findIndex((c) => c.uid === input.cardUid);
    const previous = g.pending;
    g.discard.push(...p.hand.splice(index, 1));
    g.pending = {
      kind: "technology",
      actor: p.id,
      choices: [pick(g, CARDS.technology).id, pick(g, CARDS.technology).id],
      resume: g.phase,
      resumePending: previous,
    };
    g.phase = "choice";
    log(g, p.id, "technology_draw", "科技堆抽两张，选择一张立即生效", {
      choices: g.pending.choices,
    });
  } else if (input.type === "discard") {
    const i = p.hand.findIndex((c) => c.uid === input.cardUid);
    requireRule(i >= 0, "无此手牌");
    g.discard.push(...p.hand.splice(i, 1));
  } else if (
    g.pending &&
    g.pending.kind !== "flood" &&
    g.pending.kind !== "blade"
  ) {
    requireRule(input.type === "choose", "请先完成当前选择");
    resolveChoice(g, p, input);
  } else if (g.pending?.kind === "flood") {
    requireRule(input.type === "pay_flood", "请结算洪水损失");
    const cost = floodCost(g, p),
      lost = bag();
    for (const r of RESOURCES) lost[r] = take(p, r, cost.mandatory[r]);
    if (cost.optional && cost.choices.some((r) => p.resources[r] > 0)) {
      requireRule(
        cost.choices.includes(input.resource) &&
          p.resources[input.resource] > 0,
        "请选择洪水允许扣除的资源",
      );
      lost[input.resource] += take(p, input.resource);
    }
    log(g, p.id, "flood_payment", "结算个人洪水损失", {
      lost,
      requested: cost,
      protected: has(p, "reserve-crate"),
    });
    g.pending.index++;
    if (g.pending.index < g.players.length)
      g.pending.actor = g.players[g.pending.index].id;
    else finishFlood(g);
  } else if (g.pending?.kind === "blade") {
    requireRule(input.type === "blade_move", "请处理名刀的额外移动");
    const routes = reachable(p.position, 2, g.floodLevel, { escape: true });
    requireRule(routes[input.tileId], "无效的名刀逃生路径");
    p.position = input.tileId;
    p.equipment = p.equipment.filter((id) => id !== "famed-blade");
    g.pending.remaining.shift();
    if (g.pending.remaining.length) g.pending.actor = g.pending.remaining[0];
    else finishFlood(g);
  } else if (input.type === "play" || input.type === "beacon") {
    requireRule(
      ["cards", "move", "gather", "donate"].includes(g.phase),
      "当前不能使用手牌",
    );
    const index = p.hand.findIndex((c) => c.uid === input.cardUid),
      card = p.hand[index];
    requireRule(
      input.type === "beacon"
        ? has(p, "aid-beacon") && !p.roundFlags.beacon
        : !!card,
      "手牌或互助技能不可用",
    );
    if (input.type === "beacon" || card.id === "invitation") {
      requireRule(
        input.type === "beacon" || !p.roundFlags.noInvite,
        "炼金炉生效，本回合不能邀约",
      );
      const target = playerAt(g, input.targetId);
      requireRule(
        target && nearby(p, target),
        "邀约需要建立联络：同格或相邻玩家",
      );
      const give = validateBag(input.give),
        receive = validateBag(input.receive);
      if (input.type === "beacon")
        requireRule(
          sum(give) === 1 && sum(receive) === 1,
          "互助信标只能各交换一份",
        );
      requireRule(canPay(p, give), "给出的资源不足");
      g.pending = {
        kind: "trade",
        actor: target.id,
        owner: p.id,
        give,
        receive,
        cardUid: card?.uid || null,
        beacon: input.type === "beacon",
        resume: g.phase,
      };
      g.phase = "choice";
    } else {
      requireRule(card.id === "technology", "未知行动卡");
      g.discard.push(...p.hand.splice(index, 1));
      g.pending = {
        kind: "technology",
        actor: p.id,
        choices: [pick(g, CARDS.technology).id, pick(g, CARDS.technology).id],
        resume: g.phase,
      };
      g.phase = "choice";
      log(g, p.id, "technology_draw", "科技堆抽两张，选择一张立即生效", {
        choices: g.pending.choices,
      });
    }
  } else if (input.type === "skip") {
    const next = { cards: "move", move: "gather", gather: "donate" }[g.phase];
    if (next) g.phase = next;
    else {
      requireRule(g.phase === "donate", "当前步骤不可跳过");
      finishTurn(g);
    }
  } else if (input.type === "move") {
    requireRule(g.phase === "move", "请在移动步骤操作");
    const max = 2 + (has(p, "skateboard-shoes") ? 1 : 0);
    const path = reachable(p.position, max, g.floodLevel, {
      escape: flooded(tileById(p.position), g.floodLevel),
    })[input.tileId];
    requireRule(path, "只能沿相邻陆地移动 0—2 格（科技加成另计）");
    p.position = input.tileId;
    g.phase = "gather";
    log(g, p.id, "path", "移动路径", { path });
  } else if (input.type === "gather") {
    requireRule(g.phase === "gather", "本回合已经采集或尚未进入采集");
    const tile = tileById(p.position);
    requireRule(
      tile.resource && !flooded(tile, g.floodLevel),
      "当前位置没有可采集的资源或已被洪水淹没",
    );
    add(p, tile.resource, 1 + (has(p, "mining-drone") ? 1 : 0));
    g.phase = "donate";
  } else if (input.type === "donate") {
    requireRule(g.phase === "donate", "请在上交材料步骤操作");
    const amounts = validateBag(input.amounts);
    pay(p, amounts);
    for (const r of RESOURCES) {
      g.ark[r] += amounts[r];
      p.donated[r] += amounts[r];
    }
    const record = {
      round: g.round,
      playerId: p.id,
      amounts,
      position: p.position,
      eventSeq: g.events.length + 1,
    };
    g.donations.push(record);
    log(g, p.id, "donation", "向方舟上交材料", { donation: record });
    finishTurn(g);
  } else fail("未知游戏操作");
  updateWorld(g);
  const effects = g.players.map((after, i) => ({
    playerId: after.id,
    resources: Object.fromEntries(
      RESOURCES.map((r) => [r, after.resources[r] - before[i].resources[r]]),
    ),
    attributes: Object.fromEntries(
      Object.keys(after.attributes).map((k) => [
        k,
        after.attributes[k] - before[i].attributes[k],
      ]),
    ),
    from: before[i].position,
    to: after.position,
    handBefore: before[i].hand.map((c) => c.id),
    handAfter: after.hand.map((c) => c.id),
    equipment: after.equipment,
  }));
  log(
    g,
    p.id,
    "action",
    `${p.name} · ${PHASE_NAMES[original.phase]}：${ACTION_NAMES[input.type]}`,
    {
      round: original.round,
      turn: original.turn,
      phaseBefore: original.phase,
      phaseAfter: g.phase,
      command: { ...input },
      effects,
      arkDelta: Object.fromEntries(
        RESOURCES.map((r) => [r, g.ark[r] - arkBefore[r]]),
      ),
    },
  );
  g.revision++;
  return g;
}
export function viewGame(g) {
  const result = structuredClone(g);
  delete result.rng;
  const p = activePlayer(g);
  result.activePlayerId = p?.id;
  result.reachable =
    g.phase === "move"
      ? reachable(
          p.position,
          2 + (has(p, "skateboard-shoes") ? 1 : 0),
          g.floodLevel,
          { escape: true },
        )
      : g.pending?.kind === "blade"
        ? reachable(p.position, 2, g.floodLevel, { escape: true })
        : g.pending?.kind === "repeller"
          ? reachable(p.position, 1, g.floodLevel, { away: true })
          : {};
  if (g.pending?.kind === "flood") result.pending.cost = floodCost(g, p);
  return result;
}
