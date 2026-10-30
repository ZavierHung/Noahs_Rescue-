// A deterministic local bot, used only by tests/CLI, never wired to public actions.
import { activePlayer, bag, command, createGame, floodCost } from "./engine.js";
import { CHARACTERS, RESOURCES } from "./catalog.js";
import { tileById, distance, reachable } from "./map.js";
import { handLimit, canGather } from "./world.js";
import { invitationTargets, rulesFor } from "./rules.js";
const available = (p) => RESOURCES.find((r) => p.resources[r] > 0);
export function botAction(g, { policy = "balanced", seed = 1 } = {}) {
  const p = activePlayer(g),
    pending = g.pending;
  const routes = () =>
    reachable(
      p.position,
      pending?.kind === "evacuation"
        ? rulesFor(g).finalEvacuationSteps
        : pending?.kind === "repeller"
          ? 1
          : pending?.kind === "blade"
            ? 2
            : rulesFor(g).baseMove +
              (p.equipment.includes("skateboard-shoes") ? 1 : 0),
      g.floodLevel,
      {
        escape: pending?.kind !== "repeller",
        away: pending?.kind === "repeller",
      },
    );
  const input = { actor: p.id, revision: g.revision };
  // Frozen, resource-aware policy: no access to future cards/dice or survival targets.
  const style =
    policy === "mixed"
      ? ["generous", "balanced", "cautious"][(Number(p.id.slice(1)) + seed) % 3]
      : policy;
  const wanted = () => {
    if (g.round >= 4 && p.resources.seed < (style === "cautious" ? 2 : 1))
      return "seed";
    if (g.round >= 6 && p.resources.electricity < 1) return "electricity";
    return [...RESOURCES].sort(
      (a, b) =>
        g.ark[a] + p.resources[a] - g.ark[b] - p.resources[b] ||
        RESOURCES.indexOf(a) - RESOURCES.indexOf(b),
    )[0];
  };
  if (pending) {
    const kind = pending.kind;
    if (kind === "public_event") {
      // Pick from visible consequences: prefer repairing a below-neutral
      // dimension, otherwise add supplies. This is a reproducible simple
      // policy, not an optimal moral judgment or a target-rate adjustment.
      const repair = pending.card.options.find(
        (option) =>
          Object.entries(option.effects.world).some(
            ([key, delta]) => delta > 0 && g.attributes[key] < 10,
          ) && Object.values(option.effects.world).every((delta) => delta >= 0),
      );
      const option =
        repair ||
        pending.card.options.find((option) =>
          Object.values(option.effects.ark).some((amount) => amount > 0),
        ) ||
        pending.card.options[0];
      return { ...input, type: "choose", optionId: option.id };
    }
    if (kind.startsWith("disaster_"))
      return {
        ...input,
        type: "choose",
        resource: kind === "disaster_gain" ? wanted() : available(p),
      };
    if (kind === "eco_block") return { ...input, type: "choose", block: false };
    if (kind === "flood") {
      const cost = floodCost(g, p);
      return {
        ...input,
        type: "pay_flood",
        resource: cost.choices.find((r) => p.resources[r] > cost.mandatory[r]),
      };
    }
    if (kind === "blade" || kind === "evacuation") {
      const tileId = Object.keys(routes()).sort(
        (a, b) =>
          distance(tileById(a), tileById("0,0")) -
          distance(tileById(b), tileById("0,0")),
      )[0];
      return {
        ...input,
        type: kind === "blade" ? "blade_move" : "evacuate",
        tileId,
      };
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
          return {
            ...input,
            type: "choose",
            techId,
            spend,
            resource: wanted(),
          };
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
    if (kind === "invitation") {
      const owner = g.players.find((p) => p.id === pending.owner);
      return {
        ...input,
        type: "choose",
        accept:
          !!owner &&
          !owner.roundFlags.noInvite &&
          owner.hand.some((c) => c.uid === pending.cardUid) &&
          invitationTargets(g, owner).some(
            (t) => t.playerId === p.id && t.eligible,
          ),
        resource: wanted(),
      };
    }
    if (["prototype", "recover"].includes(kind)) {
      if (p.hand.length >= handLimit(g, p))
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
          ? { tileId: Object.keys(routes()).find((id) => id !== p.position) }
          : {}),
      };
  }
  if (g.phase === "cards") {
    const invitation =
      !p.roundFlags.noInvite && p.hand.find((c) => c.id === "invitation");
    const target = invitationTargets(g, p).find((t) => t.eligible);
    if (invitation && target)
      return {
        ...input,
        type: "play",
        cardUid: invitation.uid,
        targetId: target.playerId,
        resource: wanted(),
      };
    const c = p.hand.find((c) => c.id === "technology");
    if (c) return { ...input, type: "play", cardUid: c.uid };
    return { ...input, type: "skip" };
  }
  if (g.phase === "move") {
    const current = distance(tileById(p.position), tileById("0,0"));
    const choices = Object.keys(routes())
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
        canGather(g, p) &&
        tileById(p.position).resource &&
        !(
          (tileById(p.position).zone || 4) >= 4 - g.floodLevel &&
          tileById(p.position).zone > 0
        )
          ? "gather"
          : "skip",
      // Visible-state-only choice: do not intensify a damaged ecosystem, and
      // only boost toward a still-missing ark seat. Never read future RNG.
      ...(g.learningMode
        ? {
            boost:
              p.equipment.includes("mining-drone") &&
              g.attributes.environment > 6 &&
              Object.values(g.ark).reduce((a, b) => a + b, 0) <
                rulesFor(g).arkUnitsPerSeat *
                  Math.min(g.players.length, rulesFor(g).arkMaxSeats),
          }
        : {}),
    };
  if (g.phase === "donate") {
    const amounts = { ...p.resources };
    if (style !== "generous") {
      if (g.round >= 4)
        amounts.seed = Math.max(
          0,
          amounts.seed - (style === "cautious" ? 2 : 1),
        );
      if (g.round >= 6 && g.round <= 7)
        amounts.electricity = Math.max(0, amounts.electricity - 1);
      if ([3, 5, 7].includes(g.round)) {
        const r = ["wood", "metal", "electricity"].find((r) => amounts[r] > 0);
        if (r) amounts[r]--;
      }
    }
    return {
      ...input,
      type: RESOURCES.some((r) => amounts[r]) ? "donate" : "skip",
      amounts,
    };
  }
  return { ...input, type: "skip" };
}
export function simulate({
  seed = 1,
  players = 6,
  rules,
  policy = "balanced",
  learningMode = false,
  flagOffset = 0,
} = {}) {
  if (!Number.isInteger(flagOffset) || flagOffset < 0 || flagOffset > 5)
    throw Error("flagOffset must be an integer from 0 to 5");
  let game = createGame(
    {
      learningMode,
      players: CHARACTERS.slice(0, players).map((c, i) => ({
        characterId: c.id,
        flagId: `P${((i + flagOffset) % 6) + 1}`,
      })),
    },
    { seed, rules },
  );
  let commands = 0;
  while (game.status === "playing") {
    if (++commands > 2500)
      throw new Error(`simulation did not converge: seed=${seed}`);
    game = command(game, botAction(game, { policy, seed }));
    for (const p of game.players)
      for (const r of RESOURCES)
        if (!Number.isInteger(p.resources[r]) || p.resources[r] < 0)
          throw new Error("negative inventory");
  }
  return { game, commands };
}
