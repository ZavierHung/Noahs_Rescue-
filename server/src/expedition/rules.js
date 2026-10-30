import { readFileSync } from "node:fs";
import { tileById, flooded } from "./map.js";
export function validateRules(rules) {
  if (typeof rules?.version !== "string" || !rules.version.trim())
    throw Error("规则配置缺少版本");
  const bounds = {
    baseMove: [1, 4],
    baseGather: [1, 4],
    finalEvacuationSteps: [0, 2],
    floodInjuryTolerance: [0, 20],
    seedRecovery: [1, 5],
    arkUnitsPerSeat: [1, 999],
    arkMaxSeats: [1, 6],
    invitationNearestCount: [1, 5],
  };
  for (const [key, [min, max]] of Object.entries(bounds))
    if (!Number.isInteger(rules[key]) || rules[key] < min || rules[key] > max)
      throw Error(`规则配置无效：${key}`);
  return rules;
}
export const DEFAULT_RULES = Object.freeze(
  validateRules(
    JSON.parse(
      readFileSync(
        new URL("../../data/expedition/balance.json", import.meta.url),
        "utf8",
      ),
    ),
  ),
);
export const rulesFor = (g) => g.rules || DEFAULT_RULES;
const total = (b) => Object.values(b).reduce((a, n) => a + n, 0);
export function arkCapacity(g) {
  const rules = rulesFor(g),
    units = total(g.ark);
  return {
    units,
    unitsPerSeat: rules.arkUnitsPerSeat,
    maxSeats: Math.min(g.players.length, rules.arkMaxSeats),
    seats: Math.min(
      g.players.length,
      rules.arkMaxSeats,
      Math.floor(units / rules.arkUnitsPerSeat),
    ),
    nextSeatNeeds: rules.arkUnitsPerSeat - (units % rules.arkUnitsPerSeat),
  };
}
export function floodInjury(g, p) {
  return (
    p.floodInjury ??
    g.events
      .filter(
        (e) => e.type === "flood_payment" && e.actor === p.id && e.requested,
      )
      .reduce(
        (n, e) =>
          n +
          Math.max(
            0,
            total(e.requested.mandatory) + e.requested.optional - total(e.lost),
          ),
        0,
      )
  );
}
export function survivalState(g, p) {
  if (p.survival) return p.survival;
  const rules = rulesFor(g),
    injury = floodInjury(g, p),
    seedsUsed = Math.min(
      p.resources.seed,
      Math.ceil(injury / rules.seedRecovery),
    );
  const remainingInjury = Math.max(0, injury - seedsUsed * rules.seedRecovery),
    safe = !flooded(tileById(p.position), g.floodLevel);
  const alive = safe && remainingInjury <= rules.floodInjuryTolerance;
  return {
    alive,
    safe,
    injury,
    seedsUsed,
    remainingInjury,
    tolerance: rules.floodInjuryTolerance,
    reason: !safe
      ? "终局仍处于淹没区，未能生存。"
      : !alive
        ? "洪水欠缴造成的伤势超过救生耐受值，未能生存。"
        : "处于安全地块，救生后的伤势在耐受范围内。",
  };
}
// Physical proximity: straight-line map distance, not route length or hex adjacency.
export function invitationTargets(g, p) {
  const origin = tileById(p.position);
  return g.players
    .filter((t) => t.id !== p.id && t.survival?.alive !== false)
    .map((t) => ({
      playerId: t.id,
      distance:
        Math.round(
          Math.hypot(
            tileById(t.position).x - origin.x,
            tileById(t.position).y - origin.y,
          ) * 1000,
        ) / 1000,
    }))
    .sort(
      (a, b) => a.distance - b.distance || a.playerId.localeCompare(b.playerId),
    )
    .map((t, i) => ({
      ...t,
      rank: i + 1,
      eligible: i < rulesFor(g).invitationNearestCount,
    }));
}
