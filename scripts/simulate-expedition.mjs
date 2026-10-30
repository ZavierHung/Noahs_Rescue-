import { simulate } from "../server/src/expedition/simulation.js";
import { createBoardingJudge } from "../server/src/expedition/judgment.js";
import { createGodRepository } from "../server/src/god-repository.js";
import { createAcademicRetriever } from "../server/src/academic/retriever.js";
import { fileURLToPath } from "node:url";
import { createExpeditionService } from "../server/src/expedition/service.js";
const data = fileURLToPath(new URL("../server/data/", import.meta.url));
const judge = createBoardingJudge({
  godRepository: createGodRepository(data),
  retriever: await createAcademicRetriever(),
  random: () => 0,
});
const count = Number(process.argv[2] || 20);
if (!Number.isInteger(count) || count < 1 || count > 500)
  throw new Error("simulation count must be 1—500");
let commands = 0,
  events = 0,
  donations = 0,
  conversations = 0;
for (let seed = 1; seed <= count; seed++) {
  const result = simulate({ seed, players: (seed % 6) + 1 });
  let memory = { schemaVersion: 1, games: [result.game] };
  const store = {
    read: async () => structuredClone(memory),
    write: async (_name, value) => {
      memory = structuredClone(value);
    },
  };
  const service = createExpeditionService({ store, judge });
  let reviewed = await service.action(result.game.id, {
    type: "judge",
    revision: result.game.revision,
  });
  while (reviewed.reviewRemaining.length)
    reviewed = await service.action(result.game.id, {
      type: "discuss",
      actor: reviewed.activePlayerId,
      revision: reviewed.revision,
      text: "请按真实日志核对我的捐赠、合作和伤害记录。",
    });
  reviewed = await service.action(result.game.id, {
    type: "finalize",
    revision: reviewed.revision,
  });
  const judgment = reviewed.judgment;
  if (reviewed.status !== "finished" || !judgment.final)
    throw Error("council did not finalize");
  conversations += judgment.conversations.length;
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
      conversations,
      council:
        "initial → every survivor discusses → final; real service with memory-only JSON store",
      mode: "isolated deterministic simulation; no LLM/API key or live save access",
      result: "passed",
    },
    null,
    2,
  ),
);
