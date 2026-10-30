import { readFileSync } from "node:fs";
import { log, requireRule } from "./runtime.js";
import { changeWorld } from "./world.js";

export const PUBLIC_EVENTS = JSON.parse(
  readFileSync(
    new URL("../../data/expedition/public-events.json", import.meta.url),
    "utf8",
  ),
);
const resources = ["wood", "metal", "electricity", "seed"];
const dimensions = ["economy", "environment", "society"];
requireRule(
  PUBLIC_EVENTS.cards.length === 6 &&
    new Set(PUBLIC_EVENTS.cards.map((card) => card.id)).size === 6,
  "公共事件必须恰好有六张不同卡牌",
);
for (const card of PUBLIC_EVENTS.cards) {
  requireRule(
    [card.title, card.description, card.concept, card.limitations].every(
      (value) => typeof value === "string" && value.trim(),
    ),
    "公共事件缺少说明或教育边界",
  );
  requireRule(
    card.options.length === 2 &&
      new Set(card.options.map((option) => option.id)).size === 2,
    "公共事件必须提供两个不同选项",
  );
  for (const option of card.options) {
    requireRule(
      Object.entries(option.effects.ark).every(
        ([key, value]) =>
          resources.includes(key) &&
          Number.isInteger(value) &&
          value >= 1 &&
          value <= 2,
      ),
      "公共事件资源收益配置无效",
    );
    requireRule(
      Object.entries(option.effects.world).every(
        ([key, value]) =>
          dimensions.includes(key) &&
          Number.isInteger(value) &&
          value >= -1 &&
          value <= 1,
      ),
      "公共事件世界变化配置无效",
    );
  }
}

// Independent deterministic stream. Drawing events never advances the card,
// disaster or flood dice stream. All mutable RNG state is checkpointed normally.
function randomEvent(state) {
  state.rng = (Math.imul(state.rng, 1664525) + 1013904223) >>> 0;
  return state.rng / 4294967296;
}

export function initializePublicEvents(game, seed) {
  // Avalanche nearby seeds before assigning a first decider, so consecutive
  // reproducible test seeds do not all pick the same seat.
  let eventSeed = ((seed >>> 0) ^ 0x9e3779b9) >>> 0;
  eventSeed = Math.imul(eventSeed ^ (eventSeed >>> 16), 0x85ebca6b);
  eventSeed = Math.imul(eventSeed ^ (eventSeed >>> 13), 0xc2b2ae35);
  eventSeed = (eventSeed ^ (eventSeed >>> 16)) >>> 0;
  const state = {
    version: PUBLIC_EVENTS.version,
    rng: eventSeed,
    rounds: [...PUBLIC_EVENTS.rounds],
    catalogSnapshot: structuredClone(PUBLIC_EVENTS.cards),
    remaining: PUBLIC_EVENTS.cards.map((card) => card.id),
    offeredRounds: [],
    choices: [],
  };
  const index = Math.floor(randomEvent(state) * game.players.length);
  state.startingDeciderId = game.players[index].id;
  game.publicEvents = state;
}

export function publicEventView(game) {
  const state = game.publicEvents;
  if (!state) return null;
  // Neither the next card draw nor the RNG stream is sent to the browser.
  return {
    version: state.version,
    rounds: [...state.rounds],
    startingDeciderId: state.startingDeciderId,
    offeredRounds: [...state.offeredRounds],
    choices: structuredClone(state.choices),
  };
}

export function beginPublicEvent(game) {
  const state = game.publicEvents;
  if (
    !state ||
    !state.rounds.includes(game.round) ||
    state.offeredRounds.includes(game.round)
  )
    return false;
  requireRule(
    game.phase === "cards" && game.pending === null,
    "公共事件只能在新回合开始时公开",
  );
  requireRule(state.remaining.length > 0, "公共事件牌堆为空");
  const [cardId] = state.remaining.splice(
    Math.floor(randomEvent(state) * state.remaining.length),
    1,
  );
  const card = state.catalogSnapshot.find((entry) => entry.id === cardId);
  requireRule(card, "公共事件配置不存在");
  const sequence = state.offeredRounds.length + 1;
  const startIndex = game.players.findIndex(
    (p) => p.id === state.startingDeciderId,
  );
  const actor =
    game.players[(startIndex + sequence - 1) % game.players.length].id;
  state.offeredRounds.push(game.round);
  game.pending = {
    kind: "public_event",
    actor,
    sequence,
    resume: "cards",
    card: structuredClone(card),
  };
  game.phase = "public_event";
  log(
    game,
    "system",
    "public_event_offer",
    `公共事件：${card.title}；由${actor}代表共同体选择`,
    {
      cardId,
      decisionActor: actor,
      sequence,
      card: structuredClone(card),
    },
  );
  return true;
}

export function resolvePublicEvent(game, input) {
  const pending = game.pending;
  requireRule(
    pending?.kind === "public_event" && game.publicEvents,
    "当前没有待决策公共事件",
  );
  requireRule(
    input.type === "choose",
    "请先选择公共事件方案，不能插入其他行动",
  );
  requireRule(input.actor === pending.actor, "请由本次公共事件的决策玩家操作");
  const option = pending.card.options.find(
    (entry) => entry.id === input.optionId,
  );
  requireRule(option, "请选择公共事件列出的方案");
  requireRule(
    input.reason === undefined ||
      (typeof input.reason === "string" && input.reason.length <= 500),
    "公共事件理由须为不超过500字的文字",
  );
  const requestedEffects = structuredClone(option.effects);
  const arkDelta = {};
  for (const [resource, amount] of Object.entries(option.effects.ark)) {
    // The six current options only grant public resources. Future spending
    // options must define an explicit full-payment policy before being added.
    requireRule(
      Number.isInteger(amount) && amount > 0 && amount <= 2,
      "公共事件物资配置无效",
    );
    game.ark[resource] += amount;
    arkDelta[resource] = amount;
  }
  const beforeWorld = { ...game.attributes };
  let worldChangeEventSeq = null;
  if (Object.keys(option.effects.world).length) {
    changeWorld(game, option.effects.world, {
      actor: "system",
      source: `公共事件：${pending.card.title}`,
    });
    const event = game.events.at(-1);
    event.cause = {
      type: "public_event",
      cardId: pending.card.id,
      decisionActor: pending.actor,
      sequence: pending.sequence,
    };
    worldChangeEventSeq = event.seq;
  }
  const record = {
    round: game.round,
    sequence: pending.sequence,
    cardId: pending.card.id,
    title: pending.card.title,
    optionId: option.id,
    label: option.label,
    decisionActor: pending.actor,
    requestedEffects,
    actualEffects: {
      ark: arkDelta,
      world: Object.fromEntries(
        Object.keys(game.attributes).map((key) => [
          key,
          game.attributes[key] - beforeWorld[key],
        ]),
      ),
    },
    worldChangeEventSeq,
    concept: pending.card.concept,
    limitations: pending.card.limitations,
    reason: (input.reason || "").trim(),
  };
  log(
    game,
    pending.actor,
    "public_event_choice",
    `公共决策：${pending.card.title}·${option.label}`,
    record,
  );
  record.eventSeq = game.events.at(-1).seq;
  game.publicEvents.choices.push(structuredClone(record));
  game.phase = pending.resume;
  game.pending = null;
}
