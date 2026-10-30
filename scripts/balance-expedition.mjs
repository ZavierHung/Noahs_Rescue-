// Offline balance experiment. No env, API, LLM or live save access.
import { simulate } from "../server/src/expedition/simulation.js";
import { DEFAULT_RULES } from "../server/src/expedition/rules.js";
import {
  judgmentContext,
  fallbackBoarding,
  validateBoarding,
} from "../server/src/expedition/judgment.js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const args = process.argv.slice(2);
const option = (key, fallback) =>
  args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const count = Number(option("--matches", 100)),
  start = Number(option("--start", 1)),
  policy = option("--policy", "mixed"),
  calibrate = args.includes("--calibrate");
if (
  !Number.isInteger(count) ||
  count < 2 ||
  count > 2000 ||
  !Number.isInteger(start) ||
  start < 1 ||
  !["mixed", "balanced", "cautious", "generous"].includes(policy)
)
  throw Error("invalid experiment options");
const rows = [];
function summary(
  tolerance = DEFAULT_RULES.floodInjuryTolerance,
  cost = DEFAULT_RULES.arkUnitsPerSeat,
) {
  const sample = rows.map((row) => {
    const alive = row.players.filter(
      (p) => p.safe && p.remainingInjury <= tolerance,
    ).length;
    const seats = Math.min(6, Math.floor(row.arkUnits / cost));
    return {
      survival: alive / 6,
      boarding: Math.min(alive, seats) / 6,
      capacity: seats,
    };
  });
  const metric = (key) => {
    const values = sample.map((x) => x[key]),
      mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance =
      values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
    const margin = 1.96 * Math.sqrt(variance / values.length);
    return {
      mean,
      ci95: [Math.max(0, mean - margin), Math.min(1, mean + margin)],
    };
  };
  return {
    survival: metric("survival"),
    boarding: metric("boarding"),
    meanCapacity: sample.reduce((n, x) => n + x.capacity, 0) / sample.length,
  };
}
for (let seed = start; seed < start + count; seed++) {
  const { game, commands } = simulate({ seed, players: 6, policy });
  const context = judgmentContext(game),
    verdict = validateBoarding(fallbackBoarding(context), context);
  if (game.events.filter((e) => e.type === "flood").length !== 3)
    throw Error(`flood schedule seed ${seed}`);
  rows.push({
    seed,
    commands,
    arkUnits: Object.values(game.ark).reduce((a, b) => a + b, 0),
    boarded: verdict.decisions.filter((d) => d.board).length,
    players: game.players.map((p) => ({ id: p.id, ...p.survival })),
    floods: 3,
  });
  if (rows.length % 25 === 0) console.error(`balanced ${rows.length}/${count}`);
}
const candidates = [];
if (calibrate)
  for (let tolerance = 0; tolerance <= 6; tolerance++)
    for (let cost = 10; cost <= 30; cost++) {
      const metrics = summary(tolerance, cost);
      candidates.push({
        tolerance,
        unitsPerSeat: cost,
        ...metrics,
        error:
          Math.abs(metrics.survival.mean - 0.8) +
          Math.abs(metrics.boarding.mean - 0.5),
      });
    }
candidates.sort((a, b) => a.error - b.error);
const report = {
  version: "balance-eval-v1",
  mode: "offline; six initial players; local deterministic boarding; no forced survival or selection",
  policy,
  seedRange: [start, start + count - 1],
  matches: count,
  denominator: 6 * count,
  rules: DEFAULT_RULES,
  metrics: summary(),
  confidence:
    "95% normal interval over independent match rates (not individual players)",
  ...(calibrate
    ? {
        calibration:
          "tolerance and capacity only affect terminal settlement; reuse completed trajectories, no future-information bot changes",
        candidates: candidates.slice(0, 12),
      }
    : {}),
  rows,
};
const output = option("--output", null);
if (output) {
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
}
console.log(JSON.stringify({ ...report, rows: undefined }, null, 2));
if (
  args.includes("--assert-target") &&
  (Math.abs(report.metrics.survival.mean - 0.8) > 0.05 ||
    Math.abs(report.metrics.boarding.mean - 0.5) > 0.05)
)
  process.exitCode = 1;
