import { simulate } from "../server/src/expedition/simulation.js";
import { createBoardingJudge } from "../server/src/expedition/judgment.js";
import { createGodRepository } from "../server/src/god-repository.js";
import { createLocalRetriever } from "../server/src/rag.js";
import { fileURLToPath } from "node:url";
const data = fileURLToPath(new URL("../server/data/", import.meta.url));
const judge = createBoardingJudge({
  godRepository: createGodRepository(data),
  retriever: await createLocalRetriever(`${data}/knowledge.json`),
  random: () => 0,
});
const count = Number(process.argv[2] || 20);
if (!Number.isInteger(count) || count < 1 || count > 500)
  throw new Error("simulation count must be 1—500");
let commands = 0,
  events = 0,
  donations = 0;
for (let seed = 1; seed <= count; seed++) {
  const result = simulate({ seed, players: (seed % 6) + 1 });
  const judgment = await judge(result.game);
  if (
    result.game.round !== 8 ||
    result.game.events.filter((e) => e.type === "flood").length !== 3
  )
    throw new Error("round/flood schedule invalid");
  if (judgment.verdict.decisions.length !== result.game.players.length)
    throw new Error("incomplete boarding verdict");
  commands += result.commands;
  events += result.game.events.length;
  donations += result.game.donations.length;
}
console.log(
  JSON.stringify(
    {
      matches: count,
      roundsPerMatch: 8,
      commands,
      events,
      donations,
      mode: "isolated deterministic simulation; no LLM/API key or live save access",
      result: "passed",
    },
    null,
    2,
  ),
);
