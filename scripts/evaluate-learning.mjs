// Offline, reproducible feedback for a bounded learning iteration. This never
// reads .env or live saves, and never calls an LLM. JSON is written only when
// the caller explicitly supplies --output.
import { simulate } from "../server/src/expedition/simulation.js";
import {
  judgmentContext,
  fallbackBoarding,
  validateBoarding,
} from "../server/src/expedition/judgment.js";
import { DEFAULT_RULES } from "../server/src/expedition/rules.js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const option = (name, fallback) =>
  args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const matches = Number(option("--matches", 20));
const start = Number(option("--start", 1));
const policy = option("--policy", "mixed");
const learningMode = args.includes("--learning");
const output = option("--output", null);
if (
  !Number.isInteger(matches) ||
  matches < 2 ||
  matches > 2000 ||
  !Number.isInteger(start) ||
  start < 1 ||
  !["mixed", "balanced", "cautious", "generous"].includes(policy)
)
  throw Error("invalid experiment options");

const dimensions = ["economy", "environment", "society"];
const sum = (values) => Object.values(values).reduce((a, b) => a + b, 0);
const mean = (values) => sum(values) / values.length;
const count = (values, key) =>
  values.reduce((counts, value) => {
    const label = key(value);
    counts[label] = (counts[label] || 0) + 1;
    return counts;
  }, {});
const confidence = (values) => {
  const average = mean(values);
  const variance =
    sum(values.map((value) => (value - average) ** 2)) / (values.length - 1);
  const margin = 1.96 * Math.sqrt(variance / values.length);
  return {
    mean: average,
    ci95: [Math.max(0, average - margin), Math.min(1, average + margin)],
  };
};
const rows = [];
for (let seed = start; seed < start + matches; seed++) {
  const { game: g, commands } = simulate({
    seed,
    players: 6,
    policy,
    learningMode,
  });
  const context = judgmentContext(g);
  const verdict = validateBoarding(fallbackBoarding(context), context);
  const actions = g.events.filter((event) => event.type === "action");
  const donations = g.players.map((player) => sum(player.donated));
  const roundWorld = Array.from({ length: 8 }, (_, index) => ({
    round: index + 1,
    ...actions.filter((event) => event.round === index + 1).at(-1)?.worldAfter,
  }));
  if (g.events.filter((event) => event.type === "flood").length !== 3)
    throw Error(`flood schedule did not complete at seed ${seed}`);
  rows.push({
    seed,
    commands,
    events: g.events.length,
    alive: g.players.filter((player) => player.survival.alive).length,
    boarded: verdict.decisions.filter((decision) => decision.board).length,
    seats: g.seats,
    ark: sum(g.ark),
    world: g.attributes,
    roundWorld,
    actionCounts: count(actions, (event) => event.command.type),
    technology: count(
      g.events.filter((event) => event.type === "technology"),
      (event) => event.cardId,
    ),
    disasters: count(
      g.events.filter((event) => event.type === "disaster_enter"),
      (event) => event.cardId,
    ),
    invitations: g.events.filter((event) => event.type === "invitation_accept")
      .length,
    boostedGather: g.events.filter((event) => event.type === "mining_boost")
      .length,
    worldExtremes: Object.fromEntries(
      dimensions.map((dimension) => [
        dimension,
        {
          lowActions: actions.filter(
            (event) => event.worldAfter[dimension] <= 2,
          ).length,
          highActions: actions.filter(
            (event) => event.worldAfter[dimension] >= 18,
          ).length,
          lowRounds: roundWorld.filter((world) => world[dimension] <= 2).length,
          highRounds: roundWorld.filter((world) => world[dimension] >= 18)
            .length,
        },
      ]),
    ),
    players: g.players.map((player) => ({
      id: player.id,
      donated: sum(player.donated),
      inventory: sum(player.resources),
      injury: player.survival.remainingInjury,
      alive: player.survival.alive,
      board: verdict.decisions.find(
        (decision) => decision.playerId === player.id,
      )?.board,
      actions: actions.filter((event) => event.actor === player.id).length,
      worldImpact: player.worldImpact,
      equipment: player.equipment,
    })),
    donationSpread: Math.max(...donations) - Math.min(...donations),
    donationGini:
      sum(donations) === 0
        ? 0
        : sum(
            donations.map((a) => sum(donations.map((b) => Math.abs(a - b)))),
          ) /
          (2 * donations.length * sum(donations)),
  });
}
const totals = (key) =>
  Object.fromEntries(
    [...new Set(rows.flatMap((row) => Object.keys(row[key])))].map((id) => [
      id,
      sum(rows.map((row) => row[key][id] || 0)),
    ]),
  );
const report = {
  version: "learning-simulation-v1",
  mode: "offline deterministic mixed-style agents; real rules; local fallback boarding; no forced outcomes; no LLM",
  learningMode,
  policy,
  matches,
  seedRange: [start, start + matches - 1],
  denominator: 6 * matches,
  rules: DEFAULT_RULES,
  limitations: [
    "These are deterministic software agents, not students: they do not establish enjoyment or learning gains.",
    "Intervals are normal approximations over independent match rates, not individual players; 20 matches are a smoke-sized sample.",
    "Seats, initial flags and turn order are fixed. Per-seat differences confound map geography, order, policy and random cards.",
    "Agents choose the first usable technology, accept legal invitations and decline ecological vetoes; they are not optimal/adversarial players.",
    "Learning agents boost only when current environment exceeds 6 and donated supplies cannot fill every seat; they never inspect future RNG or target survival rates.",
    "Peer review and LLM discussions are tested separately; these trajectories end at rule-based offline boarding.",
  ],
  metrics: {
    survival: confidence(rows.map((row) => row.alive / 6)),
    boarding: confidence(rows.map((row) => row.boarded / 6)),
    commands: mean(rows.map((row) => row.commands)),
    ark: mean(rows.map((row) => row.ark)),
    seats: mean(rows.map((row) => row.seats)),
    invitations: mean(rows.map((row) => row.invitations)),
    boostedGather: mean(rows.map((row) => row.boostedGather)),
    donationGini: mean(rows.map((row) => row.donationGini)),
    donationSpread: mean(rows.map((row) => row.donationSpread)),
    roundExtremeCounts: Object.fromEntries(
      dimensions.map((dimension) => [
        dimension,
        {
          low: sum(rows.map((row) => row.worldExtremes[dimension].lowRounds)),
          high: sum(rows.map((row) => row.worldExtremes[dimension].highRounds)),
          total: matches * 8,
        },
      ]),
    ),
    actionCounts: totals("actionCounts"),
    technology: totals("technology"),
    disasters: totals("disasters"),
    perSeat: Array.from({ length: 6 }, (_, index) => ({
      id: `P${index + 1}`,
      survival: mean(rows.map((row) => Number(row.players[index].alive))),
      boarding: mean(rows.map((row) => Number(!!row.players[index].board))),
      donation: mean(rows.map((row) => row.players[index].donated)),
    })),
  },
  rows,
};
if (output) {
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
}
console.log(JSON.stringify({ ...report, rows: undefined }, null, 2));
