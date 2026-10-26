// A deterministic local bot, used only by tests/CLI, never wired to public actions.
import {
  activePlayer,
  bag,
  command,
  createGame,
  floodCost,
  viewGame,
} from "./engine.js";
import { CHARACTERS, RESOURCES } from "./catalog.js";
import { tileById, distance } from "./map.js";
const available = (p) => RESOURCES.find((r) => p.resources[r] > 0);
export function botAction(g) {
  const p = activePlayer(g),
    v = viewGame(g),
    pending = g.pending;
  const input = { actor: p.id, revision: g.revision };
  if (pending) {
    const kind = pending.kind;
    if (kind === "flood") {
      const cost = floodCost(g, p);
      return {
        ...input,
        type: "pay_flood",
        resource: cost.choices.find((r) => p.resources[r] > cost.mandatory[r]),
      };
    }
    if (kind === "blade") {
      const tileId = Object.keys(v.reachable).sort(
        (a, b) =>
          distance(tileById(a), tileById("0,0")) -
          distance(tileById(b), tileById("0,0")),
      )[0];
      return { ...input, type: "blade_move", tileId };
    }
    if (kind === "technology") {
      for (const techId of pending.choices) {
        if (techId === "alchemy-furnace") {
          const spend = bag();
          let n = 2;
          for (const r of RESOURCES) {
            spend[r] = Math.min(p.resources[r], n);
            n -= spend[r];
          }
          if (n) continue;
          return { ...input, type: "choose", techId, spend, resource: "wood" };
        }
        if (techId === "recycling-claw") {
          const target = g.players.find(
            (t) =>
              t.id !== p.id &&
              distance(tileById(t.position), tileById(p.position)) <= 1 &&
              !p.roundFlags.noConflictWith.includes(t.id),
          );
          if (!target) continue;
          return { ...input, type: "choose", techId, targetId: target.id };
        }
        return { ...input, type: "choose", techId };
      }
      return { ...input, type: "choose", decline: true };
    }
    if (kind === "supply")
      return {
        ...input,
        type: "choose",
        resource: RESOURCES.find((r) => pending.pool[r] > 0),
      };
    if (kind === "trade")
      return {
        ...input,
        type: "choose",
        accept: RESOURCES.every((r) => p.resources[r] >= pending.receive[r]),
      };
    if (["prototype", "recover"].includes(kind)) {
      if (p.hand.length >= (p.equipment.includes("space-ring") ? 8 : 5))
        return { ...input, type: "discard", cardUid: p.hand[0].uid };
      return { ...input, type: "choose", cardUid: pending.choices[0].uid };
    }
    if (kind === "tide")
      return {
        ...input,
        type: "choose",
        resource: available(p),
        cardUid: p.hand[0]?.uid,
      };
    if (kind === "repeller")
      return {
        ...input,
        type: "choose",
        resource: available(p),
        ...(!available(p)
          ? { tileId: Object.keys(v.reachable).find((id) => id !== p.position) }
          : {}),
      };
  }
  if (g.phase === "cards") {
    const c = p.hand.find((c) => c.id === "technology");
    if (c) return { ...input, type: "play", cardUid: c.uid };
    return { ...input, type: "skip" };
  }
  if (g.phase === "move") {
    const current = distance(tileById(p.position), tileById("0,0"));
    const choices = Object.keys(v.reachable)
      .map(tileById)
      .sort((a, b) => {
        const rank = (t) =>
          distance(t, tileById("0,0")) +
          (t.resource && distance(t, tileById("0,0")) < current ? -1.1 : 0);
        return rank(a) - rank(b);
      });
    return { ...input, type: "move", tileId: choices[0].id };
  }
  if (g.phase === "gather")
    return {
      ...input,
      type:
        tileById(p.position).resource &&
        !(
          (tileById(p.position).zone || 4) >= 4 - g.floodLevel &&
          tileById(p.position).zone > 0
        )
          ? "gather"
          : "skip",
    };
  if (g.phase === "donate")
    return {
      ...input,
      type: available(p) ? "donate" : "skip",
      amounts: { ...p.resources },
    };
  return { ...input, type: "skip" };
}
export function simulate({ seed = 1, players = 6 } = {}) {
  let game = createGame(
    {
      players: CHARACTERS.slice(0, players).map((c, i) => ({
        characterId: c.id,
        flagId: `P${i + 1}`,
      })),
    },
    { seed },
  );
  let commands = 0;
  while (game.status === "playing") {
    if (++commands > 2500)
      throw new Error(`simulation did not converge: seed=${seed}`);
    game = command(game, botAction(game));
    for (const p of game.players)
      for (const r of RESOURCES)
        if (!Number.isInteger(p.resources[r]) || p.resources[r] < 0)
          throw new Error("negative inventory");
  }
  return { game, commands };
}
